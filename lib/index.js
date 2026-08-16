/**
 * dsh-notify host half (plain ESM, ASCII only).
 *
 * Event-driven conversation notifications for DSH:
 *   - assistant/message (final reply)     -> "done" notification (800ms debounce;
 *                                            cancelled by a following step/start)
 *   - agent/error                        -> "error" notification
 *   - goal/changed(complete)             -> "goal done" notification
 *   - ask_user_question / approval       -> "ask" notification (immediate)
 * Subagent sessions are skipped (event.origin === 'subagent').
 * NOTE: this DSH version emits NO `turn/end` event; completion is derived
 * from assistant/message + debounce (see apply()).
 *
 * Foreground-suppression ("notify only in the background"):
 *   - completion-class notifications (done/error/goal) are SKIPPED while the
 *     app is in the foreground (web page visible OR any desktop-shell window
 *     focused); they fire only when the user is away from the app.
 *   - ask/approval notifications always fire: they mean "the agent is blocked
 *     and needs you to come back and act", so they must interrupt even in the
 *     foreground.
 *   Foreground state is reported in-memory (not persisted) by two channels:
 *     POST /dsh-notify/foreground { page: bool }   <- the web page (visibility
 *                                                      / window focus events)
 *     POST /dsh-notify/foreground { shell: bool }  <- the desktop shell (any
 *                                                      of its windows focused)
 *   Either channel reporting foreground wins (page OR shell). The initial
 *   state is background (notifications fire) so a broken reporting link can
 *   never silently swallow notifications.
 *
 * Config lives in ~/.dsh/dsh-notify.json and is hot-reloaded per notification.
 * The bell in the conversation header reads/writes the same config through
 * GET/POST /dsh-notify/config.
 *
 * Testability: the pure decision/argument logic (decideNotify, buildNotifyArgs,
 * loadConfig, saveConfig, isSameOrigin, titleOf, formatElapsed, systemLang, tr)
 * is exported; the powershell spawn is injectable via __setSpawnForTests and
 * state resets via __resetForTests. Production behavior is unchanged.
 */

import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-notify';
export const inject = [];

const DEFAULTS = { sound: true, toast: true, volume: 1.0, serviceNotify: true, notifications: true };
const NOTIFY_SCRIPT = fileURLToPath(new URL('./notify.ps1', import.meta.url));
const CONFIG_ROUTE = '/dsh-notify/config';
const FOREGROUND_ROUTE = '/dsh-notify/foreground';
const DEDUPE_MS = 5000;

// --- foreground state (in-memory, dual-channel) --------------
let pageActive = false;
let shellActive = false;
function foreground() { return pageActive || shellActive; }

// --- system language (Windows) -------------------------------
let langCache = null;
export function systemLang() {
  if (langCache) return langCache;
  if (process.env.DSH_NOTIFY_LANG === 'zh' || process.env.DSH_NOTIFY_LANG === 'en') {
    langCache = process.env.DSH_NOTIFY_LANG;
    return langCache;
  }
  try {
    const r = spawnSync('reg.exe', ['query', 'HKCU\\Control Panel\\International', '/v', 'LocaleName'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const out = r.stdout.toString();
    const m = out.match(/LocaleName\s+REG_SZ\s+(\S+)/);
    langCache = m && m[1].toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch {
    langCache = 'zh';
  }
  return langCache;
}
const T = {
  zh: { conv: '对话', done: '完成', failed: '出错', goal: '目标完成', ask: '需要你选择', approve: '需要你批准' },
  en: { conv: 'Conversation', done: 'Done', failed: 'Failed', goal: 'Goal completed', ask: 'Your input needed', approve: 'Approval needed' },
};
export function tr(key) { return T[systemLang()][key]; }

function resolveHome() {
  const envHome = process.env.DSH_HOME;
  return typeof envHome === 'string' && envHome.trim() !== ''
    ? envHome
    : join(homedir(), '.dsh');
}
function configPath() { return join(resolveHome(), 'dsh-notify.json'); }

export function loadConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(configPath(), 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
export function saveConfig(cfg) {
  try {
    mkdirSync(dirname(configPath()), { recursive: true });
    const tmp = configPath() + '.tmp';
    writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    renameSync(tmp, configPath());
  } catch { /* best effort */ }
}

export function formatElapsed(ms) {
  const s = Math.round(ms / 1000);
  if (systemLang() === 'en') {
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return s % 60 > 0 ? `${m}m ${s % 60}s` : `${m}min`;
    const h = Math.floor(m / 60);
    return m % 60 > 0 ? `${h}h ${m % 60}m` : `${h}h`;
  }
  if (s < 60) return s + '秒';
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 > 0 ? `${m}分${s % 60}秒` : `${m}分钟`;
  const h = Math.floor(m / 60);
  return m % 60 > 0 ? `${h}小时${m % 60}分` : `${h}小时`;
}

/** Latest session/title event from the session's own event log. */
export function titleOf(session) {
  const events = session?.events;
  if (!Array.isArray(events)) return undefined;
  const ev = [...events].reverse().find((e) => e.type === 'session/title');
  const title = ev?.data?.title;
  if (typeof title !== 'string' || title.trim() === '') return undefined;
  return title.trim().slice(0, 20); // keep the toast one-line and tidy
}

/**
 * Pure notification decision: master switch, foreground suppression
 * (ask/approval always fire), and the same-session dedupe window.
 * @returns `{ action: 'notify', now }` or `{ action: 'skip', reason }`.
 */
export function decideNotify(cfg, soundType, foregroundActive, lastNotifyAt) {
  if (!cfg || cfg.notifications === false) return { action: 'skip', reason: 'disabled' };
  if (soundType !== 'ask' && foregroundActive) return { action: 'skip', reason: 'foreground' };
  const now = Date.now();
  if (typeof lastNotifyAt === 'number' && now - lastNotifyAt < DEDUPE_MS) return { action: 'skip', reason: 'dedupe' };
  return { action: 'notify', now };
}

/** Pure construction of the powershell notify.ps1 argument list. */
export function buildNotifyArgs(cfg, sessionId, sessionName, detail, soundType) {
  const args = ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', NOTIFY_SCRIPT,
    '-Name', sessionName || 'DeepSeek Harness',
    '-Volume', String(typeof cfg.volume === 'number' ? cfg.volume : 1.0),
    '-Tag', String(sessionId || 'goal'),
    '-Url', 'http://127.0.0.1:3080'];
  if (detail) args.push('-Detail', String(detail));
  args.push('-SoundType', soundType);
  if (!cfg.sound) args.push('-NoSound');
  if (!cfg.toast) args.push('-NoToast');
  return args;
}

// --- spawn seam (test-injectable; production behavior unchanged) -------------
let _spawnOverride = null;
/** @internal test hook - inject a spy for the powershell spawn. */
export function __setSpawnForTests(fn) { _spawnOverride = fn; }
/** @internal test hook - reset module state between tests. */
export function __resetForTests() {
  pageActive = false;
  shellActive = false;
  langCache = null;
  agentPhaseKind = 'idle';
  turnStart.clear();
  lastNotify.clear();
  _spawnOverride = null;
}
function spawnPowershell(args) {
  if (_spawnOverride) return _spawnOverride(args);
  try { return spawn('powershell.exe', args, { windowsHide: true, stdio: 'ignore' }); }
  catch (e) { console.warn('[dsh-notify] spawn failed:', e?.message ?? e); }
}

let agentPhaseKind = 'idle';
const turnStart = new Map();
const turnMaybeDone = new Map(); // sessionId -> ts of a mid-turn assistant/message
const lastNotify = new Map(); // sessionId -> ts, same-session 5s dedupe

function notify(sessionId, sessionName, detail, soundType) {
  const cfg = loadConfig();
  const decision = decideNotify(cfg, soundType, foreground(), lastNotify.get(sessionId));
  if (decision.action !== 'notify') return; // skipped calls leave no dedupe state
  lastNotify.set(sessionId, decision.now);
  spawnPowershell(buildNotifyArgs(cfg, sessionId, sessionName, detail, soundType));
}

export function isSameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site === undefined) return true;
  return site === 'same-origin' || site === 'none';
}

// --- shared HTTP helpers (used by both webServer routes) ---------------------
function sendJson(res, payload) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}
function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}
/** Drain a request body, parse it as a JSON object, then call onOk or onBad. */
function readJsonBody(req, onOk, onBad) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('bad json');
      onOk(parsed);
    } catch { onBad(); }
  });
}

export function apply(ctx, config = {}) {
  ctx.on('agent/status', ({ status }) => {
    // The event contract carries the destination status ('idle' | 'running')
    // directly; `agent.phase` is not part of the payload.
    agentPhaseKind = status === 'running' ? 'running' : 'idle';
  });

  ctx.on('session/event', (session, event) => {
    if (event.origin === 'subagent') return;
    // A new turn/step starting cancels any pending completion notification:
    // the assistant/message we saw was an intermediate tool-calling reply,
    // not the end of the turn.
    if (event.type === 'step/start' || event.type === 'turn/start') {
      const cancelTimer = turnMaybeDone.get(session.id);
      if (cancelTimer) { clearTimeout(cancelTimer); turnMaybeDone.delete(session.id); }
      if (event.type === 'turn/start') { turnStart.set(session.id, event.time); }
      return;
    }
    // The agent is waiting for the user to choose/answer: the task is blocked
    // until the user acts, so notify immediately (no debounce).
    if (event.type === 'tool/call' && event.data.name === 'ask_user_question') {
      // Row 2 = 「session name」; row 3 = subject only (no question text).
      notify(session.id, '「' + (titleOf(session) || tr('conv')) + '」', tr('ask'), 'ask');
      return;
    }
    // `approval/asked` is a SESSION event (the audit record of an approval
    // question put to the answerer chain, data: { id, toolName, callId?,
    // reason? }) - it arrives here through session/event, not as a host-level
    // event of its own.
    if (event.type === 'approval/asked') {
      const tool = typeof event.data?.toolName === 'string' && event.data.toolName !== '' ? ': ' + event.data.toolName : '';
      notify(session.id, '「' + (titleOf(session) || tr('conv')) + '」', tr('approve') + tool, 'ask');
      return;
    }
    // Turn completion: this DSH version does NOT emit `turn/end`; the durable
    // signal for "the agent produced its final reply" is the `assistant/message`
    // event (emitted per completed assistant step, data: { turn, step,
    // message }). The LAST one of a turn is the completion marker, but a
    // tool-calling turn also emits assistant/message for intermediate steps,
    // so use a debounce: schedule the notification and cancel it if another
    // assistant/message or step/start arrives before the window elapses.
    if (event.type !== 'assistant/message') return;
    const maybeTimer = turnMaybeDone.get(session.id);
    if (maybeTimer) clearTimeout(maybeTimer);
    const t = turnStart.get(session.id);
    turnStart.delete(session.id); // the turn is over; stop tracking its start
    const elapsed = typeof t === 'number' ? event.time - t : undefined;
    const suffix = elapsed !== undefined ? ' · ' + (systemLang() === 'en' ? 'took ' : '耗时 ') + formatElapsed(elapsed) : '';
    const timer = setTimeout(() => {
      turnMaybeDone.delete(session.id);
      notify(session.id, '「' + (titleOf(session) || tr('conv')) + '」', tr('done') + suffix, 'done');
    }, 800);
    turnMaybeDone.set(session.id, timer);
    return;
  });

  // Step errors are surfaced as the host-level `agent/error` event (this DSH
  // version's session/event stream carries no error reason).
  ctx.on('agent/error', (payload) => {
    const agent = payload?.agent;
    const session = agent?.session ?? null;
    const sessionId = session?.id ?? agent?.id;
    if (!sessionId) return;
    const t = turnStart.get(sessionId);
    const elapsed = typeof t === 'number' ? Date.now() - t : undefined;
    const suffix = elapsed !== undefined ? ' · ' + (systemLang() === 'en' ? 'took ' : '耗时 ') + formatElapsed(elapsed) : '';
    notify(sessionId, '「' + (titleOf(session) || tr('conv')) + '」', tr('failed') + suffix, 'error');
  });

  ctx.on('goal/changed', ({ change }) => {
    if (change?.operation === 'complete') {
      // Empty -Name breaks PowerShell -File arg parsing; fall back to the app name.
      notify(change.ref?.id ?? 'goal', 'DeepSeek Harness', tr('goal'), 'done');
    }
  });

  // Bell config API (same-origin browser fetches only).
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: CONFIG_ROUTE,
      handler: async (req, res) => {
        if (!isSameOrigin(req)) { sendText(res, 403, 'forbidden'); return; }
        if (req.method === 'GET') { sendJson(res, loadConfig()); return; }
        if (req.method === 'POST') {
          readJsonBody(req,
            (patch) => { const next = { ...loadConfig(), ...patch }; saveConfig(next); sendJson(res, next); },
            () => sendText(res, 400, 'bad json'));
          return;
        }
        sendText(res, 405, 'method not allowed');
      },
    }), 'dsh-notify: config route');

    // Foreground-state API (in-memory, same-origin only). The web page and the
    // desktop shell POST their activity; GET returns the merged snapshot.
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: FOREGROUND_ROUTE,
      handler: async (req, res) => {
        if (!isSameOrigin(req)) { sendText(res, 403, 'forbidden'); return; }
        if (req.method === 'GET') { sendJson(res, { page: pageActive, shell: shellActive, foreground: foreground() }); return; }
        if (req.method === 'POST') {
          readJsonBody(req,
            (patch) => {
              if (typeof patch.page === 'boolean') pageActive = patch.page;
              if (typeof patch.shell === 'boolean') shellActive = patch.shell;
              sendJson(res, { page: pageActive, shell: shellActive, foreground: foreground() });
            },
            () => sendText(res, 400, 'bad json'));
          return;
        }
        sendText(res, 405, 'method not allowed');
      },
    }), 'dsh-notify: foreground route');
  });

  console.log('[dsh-notify] plugin loaded (config: ' + configPath() + ')');
}
