# Plugin Development Quick Start

Pick the existing plugin closest to what you want to build and copy its folder
within `packages/plugin-dev/`.

## Option 1: Plain JavaScript (simplest)

Start from [yesterday-tasks-plugin](yesterday-tasks-plugin): `manifest.json`,
`plugin.js`, optional `index.html`, `icon.svg` and `i18n/`. No build step — zip
the files and upload them via Settings → Plugins. Every folder with a
`package.json` here is an npm workspace: rename its `"name"` and run `npm install`,
or delete the copied `package.json` if you only upload the zip.

## Option 2: TypeScript, host-side (issue providers, background logic)

Start from [github-issue-provider](github-issue-provider):

```bash
cp -r github-issue-provider my-plugin
cd my-plugin
# in src/manifest.json: set a unique "id" and "name", delete
# issueProvider.issueProviderKey (reserved for bundled providers; uploads using
# it are rejected) and change humanReadableName/icon; rename package.json "name"
# (every folder here is an npm workspace; names must be unique)
npm install        # installs into the shared plugin-dev workspace
npm run build      # → dist/
```

These plugins share `../scripts/build-with-esbuild.js` (bundles `src/plugin.ts`,
or another file via `--entry`, and copies the manifest, icon and i18n) and
`../tsconfig.base.json`; issue providers also bundle helpers from
`../issue-provider-kit/`, and all of them depend on `../../plugin-api`. These are
relative paths, so develop the plugin inside `packages/plugin-dev/`. New issue
providers: follow [add-new-integration.md](../../docs/add-new-integration.md).

For an iframe UI without a framework, see [todoist-import](todoist-import)
(`--ui src/ui/main.ts` inlines the bundled UI into `index.html`).

## Option 3: SolidJS UI (complex iframe UI)

Start from [boilerplate-solid-js](boilerplate-solid-js): Vite, SolidJS and i18n,
built with [`@super-productivity/vite-plugin`](../vite-plugin).

## Testing your plugin

1. Build it, then zip the contents of `dist/` (or the plain-JS folder):
   `rm -f plugin.zip && (cd dist && zip -r ../plugin.zip .)`.
2. Upload the zip via Settings → Plugins.

Adding a new issue provider? Read [add-new-integration.md](../../docs/add-new-integration.md).
