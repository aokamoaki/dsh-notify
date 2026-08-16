// dsh-notify test suite (node:test, zero deps).
//
// Runs against a throwaway DSH_HOME; the powershell spawn is replaced by a
// spy via the __setSpawnForTests hook, so no real powershell is ever started.
// Run with:  node --test test/
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as notify from "../lib/index.js";

let home;

beforeEach(() => {
  notify.__resetForTests();
  home = mkdtempSync(join(tmpdir(), "dsh-notify-test-"));
  process.env.DSH_HOME = home;
  process.env.DSH_NOTIFY_LANG = "zh";
});

function cleanup() {
  delete process.env.DSH_HOME;
  delete process.env.DSH_NOTIFY_LANG;
  try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
}

// --- pure helpers ---------------------------------------------------------------

describe("config", () => {
  test("defaults apply when no config file exists", () => {
    assert.deepEqual(notify.loadConfig(), { sound: true, toast: true, volume: 1.0, serviceNotify: true, notifications: true });
    cleanup();
  });

  test("saveConfig writes atomically and loadConfig reads it back merged", () => {
    notify.saveConfig({ volume: 0.5, notifications: false });
    const cfg = notify.loadConfig();
    assert.equal(cfg.volume, 0.5);
    assert.equal(cfg.notifications, false);
    assert.equal(cfg.sound, true, "unspecified keys keep defaults");
    assert.ok(existsSync(join(home, "dsh-notify.json")));
    assert.equal(existsSync(join(home, "dsh-notify.json.tmp")), false, "no tmp left behind");
    cleanup();
  });

  test("a corrupt config file falls back to defaults", () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "dsh-notify.json"), "{not json");
    assert.deepEqual(notify.loadConfig(), { sound: true, toast: true, volume: 1.0, serviceNotify: true, notifications: true });
    cleanup();
  });
});

describe("isSameOrigin", () => {
  test("same-origin / none / missing pass; cross-site rejected", () => {
    assert.equal(notify.isSameOrigin({ headers: { "sec-fetch-site": "same-origin" } }), true);
    assert.equal(notify.isSameOrigin({ headers: { "sec-fetch-site": "none" } }), true);
    assert.equal(notify.isSameOrigin({ headers: {} }), true);
    assert.equal(notify.isSameOrigin({ headers: { "sec-fetch-site": "cross-site" } }), false);
    assert.equal(notify.isSameOrigin({ headers: { "sec-fetch-site": "same-site" } }), false);
    cleanup();
  });
});

describe("titleOf", () => {
  test("latest session/title wins; blank titles ignored; 20-char cap", () => {
    assert.equal(notify.titleOf({ events: [{ type: "session/title", data: { title: "My Session" } }] }), "My Session");
    assert.equal(notify.titleOf({ events: [{ type: "session/title", data: { title: "first" } }, { type: "session/title", data: { title: "second" } }] }), "second");
    assert.equal(notify.titleOf({ events: [{ type: "session/title", data: { title: "   " } }] }), undefined);
    assert.equal(notify.titleOf({}), undefined);
    assert.equal(notify.titleOf(undefined), undefined);
    assert.equal(notify.titleOf({ events: [{ type: "session/title", data: { title: "x".repeat(40) } }] }).length, 20);
    cleanup();
  });
});

describe("formatElapsed", () => {
  test("zh formatting", () => {
    notify.__resetForTests();
    process.env.DSH_NOTIFY_LANG = "zh";
    assert.equal(notify.formatElapsed(500), "1秒");
    assert.equal(notify.formatElapsed(90_000), "1分30秒");
    assert.equal(notify.formatElapsed(3_600_000), "1小时");
    cleanup();
  });

  test("en formatting", () => {
    notify.__resetForTests();
    process.env.DSH_NOTIFY_LANG = "en";
    assert.equal(notify.formatElapsed(500), "1s");
    assert.equal(notify.formatElapsed(90_000), "1m 30s");
    assert.equal(notify.formatElapsed(3_600_000), "1h");
    cleanup();
  });
});

describe("systemLang / tr", () => {
  test("DSH_NOTIFY_LANG drives the language without touching the registry", () => {
    notify.__resetForTests();
    process.env.DSH_NOTIFY_LANG = "en";
    assert.equal(notify.systemLang(), "en");
    assert.equal(notify.tr("done"), "Done");
    notify.__resetForTests();
    process.env.DSH_NOTIFY_LANG = "zh";
    assert.equal(notify.systemLang(), "zh");
    assert.equal(notify.tr("done"), "完成");
    cleanup();
  });
});

describe("buildNotifyArgs", () => {
  const cfg = { sound: true, toast: true, volume: 1.0 };

  test("default argument shape", () => {
    const args = notify.buildNotifyArgs(cfg, "s1", "My Session", "", "done");
    assert.ok(args.includes("-NoProfile"));
    assert.ok(args.includes("-Name") && args[args.indexOf("-Name") + 1] === "My Session");
    assert.ok(args.includes("-Tag") && args[args.indexOf("-Tag") + 1] === "s1");
    assert.ok(args.includes("-Volume") && args[args.indexOf("-Volume") + 1] === "1");
    assert.ok(args.includes("-SoundType") && args[args.indexOf("-SoundType") + 1] === "done");
    assert.ok(!args.includes("-NoSound") && !args.includes("-NoToast"));
    cleanup();
  });

  test("sound/toast off append the flags; volume and detail pass through", () => {
    const args = notify.buildNotifyArgs({ sound: false, toast: false, volume: 0.35 }, "s1", "", "detail text", "error");
    assert.ok(args.includes("-NoSound"));
    assert.ok(args.includes("-NoToast"));
    assert.equal(args[args.indexOf("-Volume") + 1], "0.35");
    assert.equal(args[args.indexOf("-Detail") + 1], "detail text");
    assert.equal(args[args.indexOf("-Name") + 1], "DeepSeek Harness", "empty name falls back");
    cleanup();
  });
});

describe("decideNotify", () => {
  test("master switch, foreground suppression, ask always fires, dedupe", () => {
    const cfg = { notifications: true };
    const now = Date.now();
    assert.equal(notify.decideNotify({ notifications: false }, "ask", false, undefined).reason, "disabled");
    assert.equal(notify.decideNotify(cfg, "done", true, undefined).reason, "foreground");
    assert.equal(notify.decideNotify(cfg, "done", false, undefined).action, "notify");
    assert.equal(notify.decideNotify(cfg, "ask", true, undefined).action, "notify", "ask must interrupt foreground");
    assert.equal(notify.decideNotify(cfg, "done", false, now - 1000).reason, "dedupe");
    assert.equal(notify.decideNotify(cfg, "done", false, now - 10_000).action, "notify");
    cleanup();
  });
});

// --- apply() wiring with a spawn spy and mocked HTTP server ----------------------

function makeHarness() {
  const handlers = {};
  const routes = [];
  const ctx = {
    on: (name, fn) => { handlers[name] = fn; },
    inject: (deps, cb) => { cb(webCtx); },
  };
  const webCtx = {
    effect: (fn) => { fn(); return () => {}; },
    webServer: { register: (r) => { routes.push(r); return () => {}; } },
  };
  notify.apply(ctx, {});
  return { handlers, routes };
}

function fireEvent(handlers, type, data, extra = {}) {
  const session = { id: "s1", events: [{ type: "session/title", data: { title: "My Session" } }] };
  const event = { type, data, time: Date.now(), origin: undefined, ...extra };
  handlers["session/event"](session, event);
  return { session, event };
}

describe("apply() event wiring", () => {
  test("turn/end error notifies immediately with SoundType error", () => {
    const { handlers } = makeHarness();
    const calls = [];
    notify.__setSpawnForTests((args) => { calls.push(args); return {}; });
    fireEvent(handlers, "turn/end", { reason: { kind: "error" } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][calls[0].indexOf("-SoundType") + 1], "error");
    assert.equal(calls[0][calls[0].indexOf("-Name") + 1], "「My Session」");
    cleanup();
  });

  test("turn/end completed + idle notifies after the 800ms debounce", async () => {
    const { handlers } = makeHarness();
    const calls = [];
    notify.__setSpawnForTests((args) => { calls.push(args); return {}; });
    handlers["agent/status"]({ status: "idle" });
    fireEvent(handlers, "turn/end", { reason: { kind: "completed" } });
    assert.equal(calls.length, 0, "debounced");
    await new Promise((r) => setTimeout(r, 950));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][calls[0].indexOf("-SoundType") + 1], "done");
    cleanup();
  });

  test("completed while the agent is running stays quiet (no false 'done')", async () => {
    const { handlers } = makeHarness();
    const calls = [];
    notify.__setSpawnForTests((args) => { calls.push(args); return {}; });
    handlers["agent/status"]({ status: "running" });
    fireEvent(handlers, "turn/end", { reason: { kind: "completed" } });
    await new Promise((r) => setTimeout(r, 950));
    assert.equal(calls.length, 0);
    cleanup();
  });

  test("ask_user_question notifies immediately with SoundType ask", () => {
    const { handlers } = makeHarness();
    const calls = [];
    notify.__setSpawnForTests((args) => { calls.push(args); return {}; });
    fireEvent(handlers, "tool/call", { name: "ask_user_question" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][calls[0].indexOf("-SoundType") + 1], "ask");
    cleanup();
  });

  test("approval/asked notifies with the tool name in the detail", () => {
    const { handlers } = makeHarness();
    const calls = [];
    notify.__setSpawnForTests((args) => { calls.push(args); return {}; });
    fireEvent(handlers, "approval/asked", { id: "a1", toolName: "write_file" });
    assert.equal(calls.length, 1);
    const detail = calls[0][calls[0].indexOf("-Detail") + 1];
    assert.ok(detail.includes("需要你批准") && detail.includes("write_file"));
    cleanup();
  });

  test("goal completion notifies with SoundType done", () => {
    const { handlers } = makeHarness();
    const calls = [];
    notify.__setSpawnForTests((args) => { calls.push(args); return {}; });
    handlers["goal/changed"]({ change: { operation: "complete", ref: { id: "g1" } } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][calls[0].indexOf("-SoundType") + 1], "done");
    cleanup();
  });

  test("subagent-origin events are skipped entirely", () => {
    const { handlers } = makeHarness();
    const calls = [];
    notify.__setSpawnForTests((args) => { calls.push(args); return {}; });
    fireEvent(handlers, "turn/end", { reason: { kind: "error" } }, { origin: "subagent" });
    fireEvent(handlers, "tool/call", { name: "ask_user_question" }, { origin: "subagent" });
    assert.equal(calls.length, 0);
    cleanup();
  });

  test("foreground suppresses done/error but ask still fires", () => {
    const { handlers, routes } = makeHarness();
    const calls = [];
    notify.__setSpawnForTests((args) => { calls.push(args); return {}; });
    // mark foreground via the route
    const fg = routes.find((r) => r.path === "/dsh-notify/foreground");
    const req = { method: "POST", headers: { "sec-fetch-site": "same-origin" }, on: (n, fn) => { if (n === "data") fn(Buffer.from('{"page":true}')); if (n === "end") fn(); } };
    const res = { status: 0, body: "", writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
    fg.handler(req, res);
    fireEvent(handlers, "turn/end", { reason: { kind: "error" } });
    assert.equal(calls.length, 0, "completion-class suppressed in foreground");
    fireEvent(handlers, "tool/call", { name: "ask_user_question" });
    assert.equal(calls.length, 1, "ask fires even in foreground");
    cleanup();
  });

  test("same-session dedupe: two error turns within 5s spawn once", () => {
    const { handlers } = makeHarness();
    const calls = [];
    notify.__setSpawnForTests((args) => { calls.push(args); return {}; });
    fireEvent(handlers, "turn/end", { reason: { kind: "error" } });
    fireEvent(handlers, "turn/end", { reason: { kind: "error" } });
    assert.equal(calls.length, 1);
    cleanup();
  });
});

// --- HTTP routes ---------------------------------------------------------------

function routeFor(routes, path) {
  const r = routes.find((x) => x.path === path);
  assert.ok(r, `route ${path} registered`);
  return r;
}
function makeReq(method, headers, body) {
  // Deliver any body synchronously when the handler subscribes, so the async
  // handler completes before `await handler(...)` resolves.
  return {
    method,
    headers,
    on: (n, fn) => {
      if (body !== undefined && n === "data") fn(Buffer.from(body));
      if (body !== undefined && n === "end") fn();
    },
  };
}
function makeRes() {
  return { status: 0, body: "", headers: {}, writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } };
}

describe("HTTP /dsh-notify/config", () => {
  test("GET returns the merged config; POST updates and persists; bad json 400; cross-origin 403; PUT 405", async () => {
    const { routes } = makeHarness();
    const cfg = routeFor(routes, "/dsh-notify/config");

    const getRes = makeRes();
    await cfg.handler(makeReq("GET", { "sec-fetch-site": "same-origin" }), getRes);
    assert.equal(getRes.status, 200);
    assert.equal(JSON.parse(getRes.body).notifications, true);

    const postRes = makeRes();
    await cfg.handler(makeReq("POST", { "sec-fetch-site": "same-origin" }, '{"volume":0.4,"notifications":false}'), postRes);
    assert.equal(postRes.status, 200);
    assert.equal(JSON.parse(postRes.body).volume, 0.4);
    assert.equal(JSON.parse(readFileSync(join(home, "dsh-notify.json"), "utf8")).volume, 0.4, "persisted");

    const badRes = makeRes();
    await cfg.handler(makeReq("POST", { "sec-fetch-site": "same-origin" }, "{oops"), badRes);
    assert.equal(badRes.status, 400);

    const xRes = makeRes();
    await cfg.handler(makeReq("GET", { "sec-fetch-site": "cross-site" }), xRes);
    assert.equal(xRes.status, 403);

    const putRes = makeRes();
    await cfg.handler(makeReq("PUT", { "sec-fetch-site": "same-origin" }), putRes);
    assert.equal(putRes.status, 405);
    cleanup();
  });
});

describe("HTTP /dsh-notify/foreground", () => {
  test("GET reports the merged state; POST sets page/shell; bad json 400", async () => {
    const { routes } = makeHarness();
    const fg = routeFor(routes, "/dsh-notify/foreground");

    const get1 = makeRes();
    await fg.handler(makeReq("GET", { "sec-fetch-site": "same-origin" }), get1);
    assert.deepEqual(JSON.parse(get1.body), { page: false, shell: false, foreground: false });

    const post1 = makeRes();
    await fg.handler(makeReq("POST", { "sec-fetch-site": "same-origin" }, '{"page":true}'), post1);
    assert.equal(JSON.parse(post1.body).foreground, true);

    const get2 = makeRes();
    await fg.handler(makeReq("GET", { "sec-fetch-site": "same-origin" }), get2);
    assert.deepEqual(JSON.parse(get2.body), { page: true, shell: false, foreground: true });

    // non-boolean fields are silently ignored (lenient API), not an error
    const lenientRes = makeRes();
    await fg.handler(makeReq("POST", { "sec-fetch-site": "same-origin" }, '{"page":"yes"}'), lenientRes);
    assert.equal(lenientRes.status, 200);
    const still = makeRes();
    await fg.handler(makeReq("GET", { "sec-fetch-site": "same-origin" }), still);
    assert.deepEqual(JSON.parse(still.body), { page: true, shell: false, foreground: true }, "state unchanged");

    const badRes = makeRes();
    await fg.handler(makeReq("POST", { "sec-fetch-site": "same-origin" }, "{oops"), badRes);
    assert.equal(badRes.status, 400);
    cleanup();
  });
});
