# Publishing @super-productivity/plugin-api

## How it is published

[`publish-plugin-api.yml`](../../.github/workflows/publish-plugin-api.yml)
publishes this package to npm on every stable app release, with the app's
version: `plugin-api@19.4.0` describes the plugin API of Super Productivity
19.4.0. Plugin authors set `minSupVersion` to the version they build against.

- The `version` in this folder's `package.json` is a placeholder; CI sets the
  real one from the release tag (`npm pkg set version=…`). Do not publish by
  hand.
- Prereleases are not published.
- To publish an older tag or re-run a failed publish, dispatch the workflow
  from master with `release_tag` (e.g. `v19.4.0`). It builds that tag's tree and
  skips versions already on npm.
- Authentication is npm trusted publishing (OIDC): on npmjs.com, the package's
  Settings → Trusted publisher lists this repository and `publish-plugin-api.yml`.
  No npm token is stored in the repository.

Like `@types/vscode`, a minor version may tighten types. Exported symbols are
not withdrawn: third-party plugins depend on them (see
[feature-review-guide.md](../../docs/feature-review-guide.md#long-term-cost-of-a-change)).

## Changing the API

1. Edit `src/types.ts` (or `src/issue-provider-types.ts`). The app imports these
   sources directly through `tsconfig` paths, so no build is needed for the app.
2. Check: `npm --prefix packages/plugin-api run typecheck` and
   `npm run plugin-starter:check` from the repository root.
3. Document user-facing additions in
   [docs/plugin-development.md](../../docs/plugin-development.md) and
   [docs/wiki/3.01-API.md](../../docs/wiki/3.01-API.md).

## Testing the package locally

```bash
cd packages/plugin-api
npm pack                       # builds dist/ and writes a .tgz
cd /path/to/your-plugin
npm install --save-dev /path/to/super-productivity-plugin-api-*.tgz
```

## Package contents

- `dist/` — compiled `index`, `types`, `issue-provider-types` and `global`
- `global.d.ts` — entry point for
  `/// <reference types="@super-productivity/plugin-api/global" />`, which
  declares the global `PluginAPI` for plain-JavaScript plugins
