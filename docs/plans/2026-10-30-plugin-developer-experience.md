# Plugin developer experience

## Objective

Make it much easier for users to build their own plugins, and more inviting to
start from the plugins page. Measure of success: someone with a code editor and
no knowledge of this repository goes from "I want a plugin" to a working,
installable ZIP in their own repository in under 15 minutes, with editor
autocomplete for the whole API.

Not a goal: more API surface, an in-app store with ratings, an in-app code
editor, a separate docs site.

## Demand

- 28 entries in `src/assets/community-plugins.json`, every one in the author's
  own GitHub or Codeberg repository, none inside this monorepo.
- The issue tracker has almost no plugin-tooling complaints. That is weak
  evidence either way: authors who get stuck tend to give up silently. The
  concrete breakage below does not depend on demand to be worth fixing; the new
  surfaces (steps 4 and 6) do, so they stay small.

## Current state (measured 2026-10-30, master)

1. **npm types are stale.** `@super-productivity/plugin-api@1.0.1` (published
   2025-06-29) lacks ~38 `PluginAPI` members that `packages/plugin-api/src/types.ts`
   has: `registerIssueProvider`, secrets, OAuth, counters, `translate`,
   `onReady`, `registerTaskContextMenuEntry`, `downloadFile`, … Publishing is a
   manual `npm publish` (`packages/plugin-api/PUBLISHING.md`).
2. **`@super-productivity/vite-plugin` is not on npm.** The SolidJS boilerplate
   depends on `file:../../plugin-api` and `file:../../vite-plugin`;
   `QUICK_START.md` says to develop inside `packages/plugin-dev/`.
3. **No global `PluginAPI` type.** The `declare global` block in `types.ts` is
   commented out; plugins redeclare `PluginAPI`, two of them (CalDAV, Google
   Calendar) as hand-written partial types. Plain-JS authors get no autocomplete.
4. **No manifest schema.** Typos and invalid hooks go unnoticed: the boilerplate
   manifest declares hook `"contextChange"` (does not exist; the hook is
   `workContextChange`). `author` and `homepage` are used by most bundled
   manifests and `author` is shown by the plugins page, but neither is in
   `PluginManifest`.
5. **The guide drifts.** `docs/plugin-development.md` (1017 lines) says it "might
   not always be perfectly up to date"; 30 of 82 `PluginAPI` members are never
   mentioned in it. Its "vibe coding" section tells people to point an LLM at
   that guide and use nothing outside it.
6. **Slow test loop.** Edit → build → zip by hand → Settings → Plugins → upload.
   Re-uploading the same id replaces the plugin in place, but there is no
   load-unpacked or reload-on-change mode.
7. **The plugins page barely invites building.** The only hint is a "Get your
   plugin to show up here" link under the community list, which assumes the
   plugin already exists.

## Prior art

Checked from vendor docs as known in 2026; not re-verified hands-on this month.

| App      | Types                                       | Start a plugin                                | Test loop                                                | Invite from the app             |
| -------- | ------------------------------------------- | --------------------------------------------- | -------------------------------------------------------- | ------------------------------- |
| Obsidian | `obsidian` npm package, versioned with app  | `obsidian-sample-plugin` GitHub template repo | Copy into vault, community "hot reload" plugin           | Docs link from community browser |
| Logseq   | `@logseq/libs` npm                          | `logseq-plugin-template-*` template repos     | Developer mode → "Load unpacked plugin"                  | Developer mode toggle           |
| Joplin   | Types shipped by the generator              | `yo joplin` generator                         | "Development plugins" folder path setting (desktop only) | None in-app                     |
| VS Code  | `@types/vscode`, versioned with app         | `yo code` generator                           | F5 Extension Development Host                            | None in-app                     |
| Raycast  | `@raycast/api` npm                          | "Create extension" command, `npm run dev`     | Dev mode with live reload                                | Command in the app              |

**Take:** types published with every app release and versioned with it
(Obsidian, VS Code); one copyable starter that works outside the monorepo
(Obsidian's template repo — no generator to maintain); a quiet in-app link.

**Deliberately don't (now):** a generator CLI (a template folder does the same
with nothing to maintain); a load-unpacked mode (step 7 — Logseq/Joplin show the
demand, but it bypasses the ZIP install consent and touches plugin loading, so it
needs its own security design); in-app developer-mode toggles that ordinary
users would see.

## Steps

### 1. Publish the packages with every release

- GitHub workflow `publish-plugin-packages.yml`: on `release: published` and
  `workflow_dispatch` (master only), builds and publishes
  `@super-productivity/plugin-api` and `@super-productivity/vite-plugin` with
  npm trusted publishing (OIDC, no token in the repo), skipping a version that
  already exists.
- **Version = app version.** The published version is set from the root
  `package.json` at publish time, so `plugin-api@19.4.0` describes exactly the
  API of Super Productivity 19.4.0 and `minSupVersion` follows directly. Jumping
  from 1.0.1 to the app version is a normal major bump. Withdrawing API symbols
  is already off the table (`feature-review-guide.md` § Plugin API), so the
  version never needs to signal breaking changes separately from the app.
- `vite-plugin/package.json`: `files`, `publishConfig`, `repository`, `license`,
  README.
- **Maintainer action:** configure npm trusted publishing for both packages
  (npmjs.com → package → Settings → Trusted publisher → this repo + workflow).

### 2. Global types

- New `packages/plugin-api/src/global.ts` declaring the global `PluginAPI`
  constant (and `window.PluginAPI`). Opt-in, so `index.ts` stays free of
  globals: `/// <reference types="@super-productivity/plugin-api/global" />` in a
  `.js` (with `// @ts-check`) or `.ts` file gives full autocomplete.
- Add `author?` and `homepage?` to `PluginManifest`, documenting what the
  app already reads (additive, optional).

### 3. Manifest JSON Schema

- `packages/plugin-api/manifest.schema.json`, shipped in the npm package and
  referenced by URL via `"$schema"` so editors validate and autocomplete
  manifests.
- Drift guard (a plugin-api `npm test`, run by the plugin-tests workflow): the
  schema's top-level keys equal `PluginManifest`'s keys, its hook enum equals
  `PluginHooks`, and every manifest under `packages/plugin-dev/` validates.
  The validator is a ~50-line subset (type, required, enum, properties,
  additionalProperties, items) — no new dependency.
- Fix the boilerplate's `contextChange` hook and `minSupVersion`.

### 4. A starter that works outside the monorepo

- `packages/plugin-starter/` (not under `plugin-dev`, so it does not join that
  npm workspace and resolves packages from npm like an external project would):
  plain `plugin.js` with `// @ts-check` + the global types, `manifest.json` with
  `$schema`, `icon.svg`, `i18n/en.json`, a dependency-free `pack` script (Node
  `zlib`, prints the sha256 that a community listing needs) and a GitHub
  release workflow that attaches `plugin.zip`.
- Usable as `npx degit super-productivity/super-productivity/packages/plugin-starter my-plugin`
  or by downloading the folder; a maintainer can later mirror it as a GitHub
  template repo.
- TypeScript and iframe UI stay on the existing in-repo examples; the starter
  README links them.

### 5. Docs: generated reference, shorter guide

- `packages/plugin-api/API.md`, generated from `types.ts` by a script using the
  TypeScript compiler API (already a dev dependency): every `PluginAPI` member
  with its signature and TSDoc. A plugin-api test fails when the file is out of
  date, so it cannot drift. It doubles as the single file to hand an LLM.
- `docs/plugin-development.md`: start with a 5-minute tutorial built on the
  starter, link the generated reference for the full method list, fix the "vibe
  coding" prompt to point at `API.md`. Keep the existing sections (manifest,
  security, node execution) — other docs link to them.
- `QUICK_START.md` and `plugin-api/README.md`: lead with the starter and the
  npm packages.

### 6. Invite from the plugins page

- In the "Install plugin" card, one quiet line: "Want to build your own? Start
  with the plugin guide." linking to the guide's tutorial. No banner, no
  dismissable nag, no new setting.
- English only (`en.json`); no placeholders, so other languages fall back.
- Wiki: `2.21-Manage-Plugins` mentions the link if it describes the card.

### 7. Load unpacked plugin (deferred, separate design)

Desktop-only "load plugin from folder" with reload on change, behind an explicit
action that shows the same risk warning as a ZIP upload. Needs: an IPC surface
to read a folder, a watcher, a rule for what persists across restarts, and a
security review of bypassing the ZIP path. Revisit once steps 1–5 ship and
authors still report the loop as the main pain.

## Risks

- **Trusted publishing not configured** → the workflow fails loudly; nothing
  ships stale silently. Until then, the npm package stays at 1.0.1.
- **Version jump** confuses anyone pinned to `^1.0.0`: they keep 1.0.1 until
  they update the range. Call it out in the README.
- **Schema too strict** → `additionalProperties: false` would flag custom keys
  in existing community manifests in the editor only; the app ignores the schema
  at install time, so nothing breaks.
