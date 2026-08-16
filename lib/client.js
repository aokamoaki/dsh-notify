// dsh-notify browser half, in the DSH client-bundle format:
// every /plugins/<id>/client.js must self-register via
// window.__ModuleLoader__.load({ id, factory }) - the loader calls
// factory(require) and uses the returned { apply, inject } module.
window.__ModuleLoader__.load({
  id: "dsh-notify",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    (() => {
      var __require = typeof require !== "undefined"
        ? require
        : (x) => { throw new Error('require("' + x + '") unavailable'); };
      var import_react = __require("react");
      var h = import_react.createElement;
      var useEffect = import_react.useEffect;
      var useState = import_react.useState;

      var CSS = [
        '.dsn{position:relative;display:inline-flex;align-items:center}',
        '.dsn-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:5px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#c9cedb);cursor:pointer;transition:background var(--ds-transition-duration-fast,.12s) var(--ds-ease-in-out,ease)}',
        '.dsn-btn:hover{background:var(--dsw-alias-hover-l2,rgba(128,140,170,.18))}',
        '.dsn-btn.dsn-off{color:var(--dsw-alias-label-tertiary,rgba(150,158,175,.55))}',
        '.dsn-vol{width:0;overflow:hidden;opacity:0;flex:none;transition:width .18s ease,opacity .18s ease}',
        '.dsn-vol.dsn-open{width:176px;opacity:1}',
        '.dsn-vol-inner{width:176px;height:30px;display:flex;align-items:center;gap:8px;padding:0 6px 0 4px;box-sizing:border-box}',
        '.dsn-vol input[type=range]{-webkit-appearance:none;appearance:none;flex:1;min-width:0;height:100%;margin:0;padding:0 7px;box-sizing:border-box;background:transparent;cursor:pointer}',
        '.dsn-vol input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(to right,var(--dsw-alias-brand-primary,#4d6bfe) var(--dsn-fill,50%),var(--dsw-alias-bg-layer-2,rgba(128,140,170,.28)) var(--dsn-fill,50%))}',
        '.dsn-vol input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;background:#111;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform var(--ds-transition-duration-fast,.1s) var(--ds-ease-in-out,ease)}',
        'body[data-ds-dark-theme] .dsn-vol input[type=range]::-webkit-slider-thumb{background:#fff}',
        '.dsn-vol input[type=range]::-webkit-slider-thumb:hover{transform:scale(1.08)}',
        '.dsn-vol input[type=range]::-webkit-slider-thumb:active{transform:scale(1.16)}',
        '.dsn-vol-num{width:34px;font-size:11px;text-align:right;color:var(--dsw-alias-label-secondary,#9aa3b2);flex:none;user-select:none}',
      ].join('');

      function Bell() {
        var _s = useState({ notifications: true, volume: 1 });
        var cfg = _s[0], setCfg = _s[1];
        var _o = useState(false);
        var open = _o[0], setOpen = _o[1];

        useEffect(function () {
          var st = document.createElement('style');
          st.textContent = CSS;
          document.head.appendChild(st);
          fetch('/dsh-notify/config', { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(setCfg)
            .catch(function () { });
          return function () { st.remove(); };
        }, []);

        var update = function (patch) {
          setCfg(function (prev) { return Object.assign({}, prev, patch); });
          fetch('/dsh-notify/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          }).catch(function () { });
        };

        var pct = Math.round((cfg.volume ?? 1) * 100);
        var isZh = (document.documentElement.lang || '').toLowerCase().startsWith('zh');
        var onTitle = isZh ? '通知已开启（点击关闭）' : 'Notifications on (click to mute)';
        var offTitle = isZh ? '通知已关闭（点击开启）' : 'Notifications off (click to unmute)';
        return h('div', {
          className: 'dsn',
          onMouseEnter: function () { setOpen(true); },
          onMouseLeave: function () { setOpen(false); },
        }, [
          h('div', { className: 'dsn-vol' + (open ? ' dsn-open' : '') }, [
            h('div', { className: 'dsn-vol-inner' }, [
              h('input', {
                type: 'range', min: 0, max: 100, value: pct,
                style: { '--dsn-fill': pct + '%' },
                title: 'Volume',
                onChange: function (e) { update({ volume: Number(e.target.value) / 100 }); },
              }),
              h('span', { className: 'dsn-vol-num' }, pct + '%'),
            ]),
          ]),
          h('button', {
            className: 'dsn-btn' + (cfg.notifications ? '' : ' dsn-off'),
            title: cfg.notifications ? onTitle : offTitle,
            onClick: function () { update({ notifications: !cfg.notifications }); },
          }, cfg.notifications ? '🔔' : '🔕'),
        ]);
      }

      // Notification controls live in the conversation-header bell only
      // (notifications toggle + volume slider). The settings-page section was
      // removed: the bell already covers notifications/volume, and
      // toast/serviceNotify keep their file defaults (editable in
      // ~/.dsh/dsh-notify.json).

      function apply(ctx) {
        ctx.slots.inject('conversation.session.header.utilities', function () {
          return ctx.slots.register({
            name: 'conversation.session.header.utilities',
            id: 'dsh-notify',
            order: 100,
          }, Bell);
        });
      }

      // Foreground reporting: completion notifications are suppressed while
      // the page is visible/focused (the host skips done/error/goal notices;
      // ask/approval always fire). Report page activity through the
      // /dsh-notify/foreground in-memory endpoint - visibilitychange covers
      // tab switches / minimization, window focus/blur covers the desktop
      // shell window losing focus to another app or window.
      function reportPageActive(active) {
        try {
          fetch('/dsh-notify/foreground', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ page: !!active }),
          }).catch(function () { });
        } catch (e) { }
      }
      document.addEventListener('visibilitychange', function () {
        reportPageActive(!document.hidden);
      });
      window.addEventListener('blur', function () { reportPageActive(false); });
      window.addEventListener('focus', function () { reportPageActive(true); });
      reportPageActive(!document.hidden);

      exports.apply = apply;
      exports.inject = ['slots'];
    })();
    return module.exports;
  }
});
