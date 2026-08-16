# Contributing

Thanks for taking a look. Small fixes and clear bug reports are very welcome.

Before opening a pull request:

1. Keep `lib/client.js` in the DSH client-bundle artifact format (`window.__ModuleLoader__.load({ id, factory })`) — no import/JSX.
2. Keep the host half plain ESM, ASCII-only, and never throw into the boot sequence.
3. Run the local checks:

   ```sh
   npm run check
   npm run pack:check
   ```

4. Update `CHANGELOG.md` for user-visible changes.

## Report a bug

Include: DSH version, platform, `~/.dsh/dsh-notify.json`, and the relevant part of `~/.dsh/dsh-preflight.log` (if a guard auto-disabled this plugin, the reason comment in `cordis.patch.yml`).
