# Super Productivity plugin starter

A minimal [Super Productivity](https://super-productivity.com) plugin in plain
JavaScript: a header button and a hook. No build step and no dependencies.

## Get started

1. Copy this folder to a folder of your own. With git:

   ```bash
   git clone --depth 1 --filter=blob:none --sparse https://github.com/super-productivity/super-productivity.git sp-source
   git -C sp-source sparse-checkout set packages/plugin-starter
   cp -r sp-source/packages/plugin-starter my-plugin
   rm -rf sp-source
   ```

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

`jsconfig.json` already points editors such as VS Code at the installed types,
so they then autocomplete every `PluginAPI` method. To also have mistakes
flagged, add `// @ts-check` as the first line of `plugin.js`.

## Which app versions it runs on

`minSupVersion` in `manifest.json` is the oldest Super Productivity version the
plugin installs on. Set it to the oldest version that has every `PluginAPI`
method you use, not simply the newest: people on slower release channels run
older versions. The npm package is versioned like the app, so its version tells
you the newest API you are building against.

## Files

| File                            | What it is                                                   |
| ------------------------------- | ------------------------------------------------------------ |
| `manifest.json`                 | Plugin id, name, version and `minSupVersion`                 |
| `plugin.js`                     | Runs once when the plugin is enabled                         |
| `icon.svg`                      | Shown in the app's plugin list                               |
| `scripts/pack.mjs`              | Builds `plugin.zip` and prints its SHA-256                   |
| `jsconfig.json`                 | Editor settings for autocomplete                             |
| `.github/workflows/release.yml` | On a `v1.2.3` tag, attaches `plugin.zip` to a GitHub release |

The ZIP gets every file except dotfiles and, at the top level, `scripts/`,
`node_modules/`, `package.json`, `package-lock.json`, `jsconfig.json`,
`tsconfig.json` and this README. The app uses `manifest.json`, `plugin.js`,
`index.html` (for a UI; set `"iFrame": true` and inline its CSS and JS),
the icon, `i18n/<language>.json` translations and a config schema; other files
are packed but not loaded.

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
