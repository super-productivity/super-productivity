# Plugin developer experience

## Objective

Make it much easier for users to build their own plugins, and more inviting to
start from the plugins page. Measure of success: someone with a code editor and
no knowledge of this repository goes from "I want a plugin" to a working,
installable ZIP in their own folder in under 15 minutes, with editor
autocomplete for the whole API.

Not a goal: more API surface, an in-app store with ratings, an in-app code
editor, a separate docs site, a generator CLI.

## Demand

- 28 entries in `src/assets/community-plugins.json`, every one in the author's
  own GitHub or Codeberg repository, none inside this monorepo.
- A sample of 13 of those repositories (2026-10-30): 5 bundle with esbuild, 5
  have no `package.json` at all (plain JS), none use Vite or
  `@super-productivity/vite-plugin`, and one uses
  `@super-productivity/plugin-api` (pinned `^1.0.1`). Plain JS outside the
  monorepo is the common case; the plan is built around it.
- The issue tracker has almost no plugin-tooling complaints. That is weak
  evidence either way: authors who get stuck tend to give up silently. Fixing
  stale published types does not depend on demand; the new surfaces (starter,
  in-app link) do, so they stay small.

## Current state (measured 2026-10-30, master at v19.3.1)

1. **npm types are stale.** `@super-productivity/plugin-api@1.0.1` (published
   2025-06-29, ~180 downloads/month) lacks 43 of the 69 `PluginAPI` members in
   `packages/plugin-api/src/types.ts` — `registerIssueProvider`, secrets, OAuth,
   counters, `translate`, `onReady`, `registerTaskContextMenuEntry`,
   `downloadFile`, … — and ships no runtime JS (no `PluginHooks` enum).
   Publishing is a manual `npm publish` (`packages/plugin-api/PUBLISHING.md`).
2. **No global `PluginAPI` type.** The `declare global` block in `types.ts` is
   commented out; plugins redeclare `PluginAPI`, three of them (CalDAV, Google
   Calendar, Gitea) as hand-written partial types. Plain-JS authors get no
   autocomplete.
3. **Examples outside the monorepo don't exist.** `QUICK_START.md` says to
   develop inside `packages/plugin-dev/`; every TypeScript example and the
   SolidJS boilerplate depend on relative paths into the repo.
4. **Small drift.** The boilerplate manifest declares hook `"contextChange"`
   (does not exist; it is `workContextChange`; `manifest.hooks` is informational,
   so nothing breaks) and `minSupVersion: "8.0.0"`. `author` is used by 21 of
   24 bundled manifests and shown on the plugins page via a local cast
   (`PluginManifestAuthor`), but is not in `PluginManifest`.
5. **The guide drifts.** `docs/plugin-development.md` (1017 lines) says it "might
   not always be perfectly up to date"; 22 of the 69 `PluginAPI` members are
   never named in it. Its "vibe coding" section tells people to point an LLM at
   that guide and use nothing outside it.
6. **Slow test loop.** Edit → zip by hand → Settings → Plugins → upload.
   Re-uploading the same id replaces the plugin in place; there is no
   load-unpacked or reload-on-change mode.
7. **The plugins page barely invites building.** The only hint is a "Get your
   plugin to show up here" link under the community list, which assumes the
   plugin already exists.

## Prior art

From vendor docs as known in 2026; not re-verified hands-on this month.

| App      | Types                                      | Start a plugin                                | Test loop                                                | Invite from the app              |
| -------- | ------------------------------------------ | --------------------------------------------- | -------------------------------------------------------- | -------------------------------- |
| Obsidian | `obsidian` npm package, versioned with app | `obsidian-sample-plugin` GitHub template repo | Copy into vault; community "hot reload" plugin           | Docs link from community browser |
| Logseq   | `@logseq/libs` npm                         | `logseq-plugin-template-*` template repos     | Developer mode → "Load unpacked plugin"                  | Developer mode toggle            |
| Joplin   | Types shipped by the generator             | `yo joplin` generator                         | "Development plugins" folder path setting (desktop only) | None in-app                      |
| VS Code  | `@types/vscode`, versioned with app        | `yo code` generator                           | F5 Extension Development Host                            | None in-app                      |
| Raycast  | `@raycast/api` npm                         | "Create extension" command, `npm run dev`     | Dev mode with live reload                                | Command in the app               |

**Take:** types published with every app release and versioned with it
(Obsidian, VS Code — including VS Code's caveat that a minor version may tighten
types); one copyable starter folder (Obsidian's template repo, no generator); a
quiet in-app link.

**Deliberately don't (now):** a generator CLI or `degit` recipe (unpinned
third-party code; downloading the folder does the same); a load-unpacked mode
(step 6); a developer-mode toggle ordinary users would see.

## Steps

### 1. Publish `plugin-api` with every release

- Workflow `publish-plugin-api.yml`:
  - `release: published`, skipping prereleases (like every other on-release
    workflow); `workflow_dispatch` takes a `release_tag` input and checks out that
    tag, so a dispatch can never publish unreleased master under a release
    version.
  - npm trusted publishing: `permissions: id-token: write`, npm ≥ 11.5.1 pinned
    in the job (Node 22 bundles npm 10), `--provenance`. No token in the repo.
  - Skips a version that already exists, so re-runs are safe.
- **Version = app version**, set in CI from the release tag (`npm version
--no-git-tag-version`); the repo copy of `packages/plugin-api/package.json`
  keeps a placeholder version and says so. `plugin-api@19.4.0` describes the API
  of Super Productivity 19.4.0, so `minSupVersion` = the version you build
  against. Like `@types/vscode`, a minor version may tighten types (e.g.
  `PluginHookHandler` gained typed payloads since 1.0.1); symbols are not
  withdrawn (`feature-review-guide.md` § Plugin API).
- `vite-plugin` stays unpublished: no community plugin uses Vite, and publishing
  it would freeze its hard-coded `src/` layout as a contract.
- **Maintainer action:** on npmjs.com, add a trusted publisher for
  `@super-productivity/plugin-api` (repository + `publish-plugin-api.yml`).

### 2. Global types and `author`

- `packages/plugin-api/src/global.ts` declares the global `PluginAPI` constant,
  with a TSDoc note that iframe code gets a filtered subset. No `window.PluginAPI`
  (it would imply the full API in iframes). A package-root `global.d.ts` shim
  (`/// <reference path="./dist/global.d.ts" />`, added to `files`) makes
  `/// <reference types="@super-productivity/plugin-api/global" />` resolve
  without an `exports` map (which would break deep imports that work today).
  `index.ts` stays free of globals, so the app and existing plugins are
  unaffected.
- Add `author?: string` to `PluginManifest` (what the plugins page already
  reads) and drop the local cast. Not `homepage`: nothing reads it.
- Fix the boilerplate's `contextChange` hook and `minSupVersion`.

### 3. A starter that works outside the monorepo

- `packages/plugin-starter/`, excluded from the root npm workspaces (like
  `plugin-dev`), so it resolves packages the way an external project does:
  - `plugin.js` with `// @ts-check` and the global types reference: a header
    button and a hook, nothing else.
  - `manifest.json`, `icon.svg`.
  - `scripts/pack.mjs`: dependency-free ZIP writer (Node `zlib`, `/` entry
    names on every OS), prints the SHA-256 a community listing needs, refuses
    a manifest without `id`/`name`/`version`.
  - `package.json` with only `@super-productivity/plugin-api` as an optional dev
    dependency for autocomplete — the starter packs and installs without
    `npm install`, so it is usable before a 19.x package is on npm.
  - A GitHub release workflow (`.github/workflows/release.yml`) that packs and
    attaches `plugin.zip`, and a README with absolute links only (relative links
    break once the folder is copied out), "test on a test instance", and how to
    get listed.
- Get it by downloading the folder (GitHub's "Download" on the folder, or
  `git sparse-checkout`); a maintainer can mirror it as a GitHub template repo
  later.
- CI (plugin-tests workflow, path-filtered on the starter and `plugin-api`):
  build `plugin-api`, typecheck `plugin.js` against it, run `pack`, and check the
  ZIP lists `manifest.json` at its root. The boilerplate's stale hook is the
  evidence that unchecked examples rot.
- TypeScript and iframe UI stay on the existing in-repo examples; the starter
  README links them.

### 4. Docs

- `docs/plugin-development.md`: open with a 5-minute tutorial on the starter;
  point the full method list and the "vibe coding" prompt at the shipped types
  (`types.ts`), which are the single source of truth; replace the "might not be
  up to date" disclaimer with that pointer. Keep the existing sections — other
  docs link to them.
- No generated `API.md` or freshness test: a generated API snapshot was already
  rejected on cost (`docs/hardening-earns-its-place.md` § Rejected guards), only
  33 of 69 members have TSDoc, and the `.d.ts` already is the single file to hand
  an LLM.
- `QUICK_START.md`, `plugin-api/README.md`, `PUBLISHING.md`: lead with the
  starter and the npm package; describe the CI publishing.
- Wiki `2.15-Develop-a-Plugin.md` (the user-facing how-to): Quick Steps start
  from the starter. `3.01-API.md`: global types and the version rule.

### 5. Invite from the plugins page

- In the "Install plugin" card, one quiet sentence with a plain link: "Want to
  build your own? Read the plugin guide." No banner, no nag, no setting, no new
  styles.
- Link the guide file (no `#anchor`: anchors rot silently; `check-doc-links`
  validates the path).
- English only (`en.json`, then `npm run int`); no placeholders.
- Wiki `2.21-Manage-Plugins.md` mentions the link if it describes the card.

### 6. Load unpacked plugin (deferred, separate design)

Desktop-only "load plugin from folder" with reload on change, behind an explicit
action showing the same risk warning as a ZIP upload. Needs an IPC surface to
read a folder, a watcher, a rule for what persists across restarts, and a
security review of bypassing the ZIP path. Revisit once steps 1–5 ship and
authors still name the loop as the main pain.

### Also deferred

- **Manifest JSON Schema.** Editor validation is nice, but `manifest.hooks` is
  informational, the app deliberately accepts extra keys
  (`validate-manifest.util.ts`), and a published schema URL becomes a contract.
  Revisit on a report of a manifest mistake the app does not already explain at
  install.
- **Shipped mock `PluginAPI` for unit tests.** New public surface; plugins
  already hand-roll small mocks.

## Risks

- **Trusted publisher not configured** → the publish workflow fails loudly;
  nothing ships stale silently. The starter still works without the package.
- **Version jump**: anyone on `^1.0.1` keeps 1.0.1 until they change the range.
  The README says so.
- **Starter rot**: covered by the CI job; its own release workflow's action pins
  are outside dependabot's root scope, so they are bumped by hand.
