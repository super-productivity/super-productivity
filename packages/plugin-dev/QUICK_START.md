# Plugin Development Quick Start

Pick the existing plugin closest to what you want to build and copy its folder
within `packages/plugin-dev/`.

## Option 1: Plain JavaScript (simplest)

Start from [yesterday-tasks-plugin](yesterday-tasks-plugin): `manifest.json`,
`plugin.js`, optional `index.html`, `icon.svg` and `i18n/`. No build step — zip
the files and upload them via Settings → Plugins.

## Option 2: TypeScript, host-side (issue providers, background logic)

Start from [github-issue-provider](github-issue-provider) (issue provider) or
[app-auto-track](app-auto-track) (background plugin):

```bash
cp -r github-issue-provider my-plugin
cd my-plugin
# set a unique "name" in package.json first: every folder here is a workspace
npm install        # installs into the shared plugin-dev workspace
npm run build      # → dist/
```

These plugins share `../scripts/build-with-esbuild.js` (bundles `src/plugin.ts`
and copies the manifest, icon and i18n) and `../tsconfig.base.json`. Issue
providers also bundle helpers from `../issue-provider-kit/`. To develop outside
this repository, copy those along with your plugin folder or inline them, and
replace the `file:../../plugin-api` dependency with the published
`@super-productivity/plugin-api` package.

For an iframe UI without a framework, see [todoist-import](todoist-import)
(`--ui src/ui/main.ts` inlines the bundled UI into `index.html`).

## Option 3: SolidJS UI (complex iframe UI)

Start from [boilerplate-solid-js](boilerplate-solid-js): Vite, SolidJS and i18n,
built with [`@super-productivity/vite-plugin`](../vite-plugin).

## Testing your plugin

1. Build it, then zip the contents of `dist/` (or the plain-JS folder).
2. Upload the zip via Settings → Plugins.

Adding a new issue provider? Read [add-new-integration.md](../../docs/add-new-integration.md).
