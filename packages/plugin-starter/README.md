# Super Productivity plugin starter

A minimal [Super Productivity](https://super-productivity.com) plugin in plain
JavaScript: a header button and a hook. No build step and no dependencies.

## Get started

1. Copy this folder (`packages/plugin-starter` in the
   [Super Productivity repository](https://github.com/super-productivity/super-productivity/tree/master/packages/plugin-starter))
   to a new folder or repository of your own.
2. In `manifest.json`, set a unique `id` (letters, numbers and dashes), your
   plugin's `name`, `description` and `author`.
3. Pack it: `node scripts/pack.mjs` (Node.js 20.15 or newer). This writes
   `plugin.zip`.
4. In Super Productivity, open **Settings → Plugins → Choose Plugin File** and
   pick `plugin.zip`. To update the plugin, pack and upload again: the same `id`
   replaces the installed version.

Try your plugin on test data, not your real tasks: use a separate browser
profile with the web app, or <https://test-app.super-productivity.com>. Open the
developer tools (F12 or Ctrl+Shift+I) to see errors and `console.log` output.

## Autocomplete and type checking (optional)

```bash
npm install --save-dev @super-productivity/plugin-api
```

`plugin.js` starts with `// @ts-check` and a reference to the API types, so
editors such as VS Code then autocomplete every `PluginAPI` method and flag
mistakes. The package is versioned like the app: set `minSupVersion` in
`manifest.json` to the version you build against.

## Files

| File                            | What it is                                                              |
| ------------------------------- | ----------------------------------------------------------------------- |
| `manifest.json`                 | Plugin id, name, version and the app version it needs (`minSupVersion`) |
| `plugin.js`                     | Runs once when the plugin is enabled                                    |
| `icon.svg`                      | Shown in the app's plugin list                                          |
| `scripts/pack.mjs`              | Builds `plugin.zip` and prints its SHA-256                              |
| `.github/workflows/release.yml` | On a `v1.2.3` tag, attaches `plugin.zip` to a GitHub release            |

Everything except development files (`scripts/`, `package.json`, this README,
dotfiles, `node_modules`) goes into the ZIP, so add an `index.html`, `i18n/`
folder or other assets next to `plugin.js` and they are included.

## Next steps

- [Plugin development guide](https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md):
  manifest fields, iframe UIs (`index.html`), translations, security.
- [API types](https://github.com/super-productivity/super-productivity/blob/master/packages/plugin-api/src/types.ts):
  every `PluginAPI` method, with comments. This is also the file to give an AI
  assistant if you use one to write your plugin.
- Examples:
  [yesterday-tasks-plugin](https://github.com/super-productivity/super-productivity/tree/master/packages/plugin-dev/yesterday-tasks-plugin)
  (iframe side panel),
  [api-test-plugin](https://github.com/super-productivity/super-productivity/tree/master/packages/plugin-dev/api-test-plugin)
  (most API calls), and for TypeScript or a bigger UI, the other plugins in
  [packages/plugin-dev](https://github.com/super-productivity/super-productivity/tree/master/packages/plugin-dev).
- Share it: [get listed in the app](https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md#get-listed-in-the-app).
  Tag a release with the included workflow and use its `plugin.zip` URL and
  SHA-256 in the listing.
