# Plugin data disclosure: one way to say what leaves the device

## Objective

One declaration, one rendering. Every plugin says in its manifest what user data it
sends off the device, to whom, and under whose terms. The app renders that statement
before the first send, on the plugin card and in the community listing. No plugin writes
its own privacy notice. This covers bundled plugins, community-listed plugins, uploaded
ZIPs, and the planned AI Command plugin.

Why now: `README.md:95` says the app "does NOT collect any data", and AGENTS.md says
"user data stays local unless explicitly synced". Both are true of the project itself.
But 12 bundled plugins already send task data to third parties, and nothing tells the
user so in one consistent place. AI Command adds a third-party AI recipient, which
Apple guideline 5.1.2(i) singles out.

Not a goal:

- sandboxing plugin code
- a consent record that syncs
- per-field toggles
- a privacy dashboard
- any change to how sync works

## Demand

- AI Command needs a disclosure and an explicit "Turn on" step before it can ship (its
  plan, on branch `claude/ai-plan-today`).
- Case-by-case notices already exist: the assistant-connector strings in `en.json`, the
  privacy section of [the assistant connector plan](2026-10-26-assistant-connector-directories.md),
  and the SuperSync policy (`packages/super-sync-server/templates/privacy.template.html:142,232`).
  Each new integration would add another.
- What the user sees today does not match what plugins do (next section). The plugin
  card advertises network access for exactly one plugin.

## Current state (measured 2026-11-03, this branch)

### What the host enforces

| Path                                     | Gate                                                                                                                                                                                                                                                                                         | Evidence                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PluginAPI.request`                      | Needs both the `http` permission and an exact host listed in `allowedHosts`; fails closed                                                                                                                                                                                                    | `packages/plugin-api/src/types.ts:178-200`, `src/app/plugins/plugin-bridge.service.ts:586-620`, validation `src/app/plugins/util/validate-manifest.util.ts:55-66`                                                                                                                                                  |
| Issue-provider HTTP (`createHttpHelper`) | **No host allowlist.** Checks the method, allows only http/https, always blocks metadata hosts, and blocks private hosts unless the provider config allows them. Only bundled plugins can allow them. `types.ts:185` says outright that `allowedHosts` "does not affect issue-provider HTTP" | `src/app/plugins/issue-provider/plugin-http.service.ts:128,182,409`, `plugin-bridge.service.ts:499`; called from the adapter, time tracking, calendar, time blocks and two-way sync (`plugin-issue-provider-adapter.service.ts:435`, `plugin-time-tracking.effects.ts:130`, `calendar-integration.service.ts:353`) |
| Plain `fetch`, iframes, `window.open`    | **None.** Plugin code runs via `new Function` in the app window, the CSP allows `connect-src *`, and iframes get `allow-same-origin`                                                                                                                                                         | `src/app/plugins/plugin-runner.ts:174`, `src/index.html:106`, `src/app/plugins/ui/plugin-index/plugin-index.component.html:78`                                                                                                                                                                                     |
| `nodeExecution`                          | Consent dialog in the main process, stored per device, never synced                                                                                                                                                                                                                          | `src/app/plugins/plugin.service.ts:397-451`, `docs/plugin-development.md:769-786`                                                                                                                                                                                                                                  |

What the user sees: `PluginSecurityService.getDeclaredApiAccess` lists network access
only for `http` together with `allowedHosts` (`src/app/plugins/plugin-security.ts:265-290`).
The plugin card renders that list (`plugin-management.component.html:105`). Uploading a
ZIP shows a generic risk dialog before the manifest has been read
(`plugin-management.component.ts:565-583`). A fresh upload starts disabled, so its code
first runs when the user turns the toggle on (`plugin.service.ts:1223`,
`plugin-management.component.ts:273-295`). Two migrations turn bundled plugins on with no
prompt: one for built-in issue providers the user had configured, one for
voice-reminder (`plugin.service.ts:146-191`).

### What each plugin sends

`PD` = `packages/plugin-dev`. "Bundled" means listed in `BUNDLED_PLUGIN_PATHS`
(`src/app/plugins/bundled-plugins.const.ts:7-30`). Defaults are the shipped mapping
directions.

| Plugin                                                          | Mechanism                     | Recipient / hosts                                                    | Data sent                                                                                                                                                                       | Evidence                                                                                                                |
| --------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| GitHub                                                          | issue-provider HTTP           | `api.github.com`, or a user-set `apiBaseUrl`                         | Token and search text. Done state. Title and notes only if the user turns push on (off/pull-only by default). Title when creating an issue                                      | `PD/github-issue-provider/src/plugin.ts:19,90,182,302-328,342,365`; manifest `permissions: []` (`src/manifest.json:12`) |
| Gitea                                                           | issue-provider HTTP           | user's server                                                        | Token and search text; read-only                                                                                                                                                | `PD/gitea-issue-provider/src/plugin.ts:86-91,212,223`                                                                   |
| Redmine                                                         | issue-provider HTTP           | user's server                                                        | API key and search text. **Worklogs:** date, hours, comment                                                                                                                     | `PD/redmine-issue-provider/src/plugin.ts:55,217,231,295-303`; `plugin-time-tracking.effects.ts:130`                     |
| Trello                                                          | issue-provider HTTP           | `api.trello.com`                                                     | Key, token and search text. Done (archive) state. Title on create, or on push if turned on                                                                                      | `PD/trello-issue-provider/src/plugin.ts:17,123,334,422-437,454`                                                         |
| Linear                                                          | issue-provider HTTP (GraphQL) | `api.linear.app`                                                     | API key; read-only, search is filtered locally                                                                                                                                  | `PD/linear-issue-provider/src/plugin.ts:16,106,152,191`                                                                 |
| Azure DevOps                                                    | issue-provider HTTP           | `dev.azure.com`, or a user's on-prem server                          | PAT and search text (inside WIQL). Done state if the user opts in                                                                                                               | `PD/azure-devops-issue-provider/src/plugin.ts:82,175,316-333,393-411`                                                   |
| Nextcloud Deck                                                  | issue-provider HTTP           | user's server                                                        | Username and password. Done state. Title on update; notes if push is turned on                                                                                                  | `PD/nextcloud-deck-issue-provider/src/plugin.ts:72,258-273,338-385`                                                     |
| ClickUp                                                         | issue-provider HTTP           | `api.clickup.com`                                                    | Token; read-only                                                                                                                                                                | `PD/clickup-issue-provider/src/clickup-api.ts:7,101,138`                                                                |
| Google Calendar                                                 | issue-provider HTTP + OAuth   | `www.googleapis.com`, `oauth2.googleapis.com`, `accounts.google.com` | OAuth token. **Two-way by default:** title, notes, due times, estimate. Time blocks add title, `[DONE]`, start/end and task id                                                  | `PD/google-calendar-provider/src/plugin.ts:19-21,562-600,720-802`; manifest has `http` but no `allowedHosts`            |
| CalDAV                                                          | issue-provider HTTP           | user's server                                                        | Username and password. Same two-way fields and time blocks as Google                                                                                                            | `PD/caldav-calendar-provider/src/plugin.ts:46,383,1499-1545,1752-1833`                                                  |
| Todoist import                                                  | `PluginAPI.request`           | `api.todoist.com`                                                    | Token; data flows in                                                                                                                                                            | `PD/todoist-import/src/parse/load-todoist-data.ts:4,14-23`; the only plugin that uses `allowedHosts`                    |
| Automations                                                     | plain `fetch`, ungated        | any webhook URL the user enters                                      | Task id, title, project id, done state, tag ids, event type                                                                                                                     | `PD/automations/src/core/actions.ts:137-178` (`fetch` at `:167`); `permissions: []`                                     |
| AI productivity prompts                                         | opens a link                  | `chat.openai.com` in the browser                                     | The prompt, which can include the selected tasks, in `?q=`                                                                                                                      | `PD/ai-productivity-prompts/src/utils.ts:72`; discover-only (`plugin.service.ts:136`)                                   |
| Voice reminder                                                  | Web Speech `speechSynthesis`  | the system speech engine; some Chromium voices are online            | Current task title, spoken aloud                                                                                                                                                | `PD/voice-reminder/plugin.js:43-66,90`                                                                                  |
| Parallel Code                                                   | `parallelcode://` link        | local app                                                            | Task id only                                                                                                                                                                    | `PD/parallel-code/plugin.js:23`                                                                                         |
| Sync.md, app auto-track                                         | `nodeExecution`               | none (local file, local OS tools)                                    | Nothing off the device                                                                                                                                                          | `PD/sync-md/src/background/helper/file-utils.ts:14`, `PD/app-auto-track/src/probe.ts:73-90`                             |
| TickTick import                                                 | local CSV file                | none                                                                 | Nothing                                                                                                                                                                         | `PD/ticktick-import/src/ui/main.ts:62`                                                                                  |
| Doc mode, brain dump, procrastination buster, yesterday's tasks | plugin API only               | none                                                                 | Nothing                                                                                                                                                                         | No `fetch` or URL calls found in their sources                                                                          |
| **AI Command** (planned)                                        | `PluginAPI.request`           | `api.anthropic.com`, or the user's Ollama / LM Studio                | Request text, date, free time, project and tag names, and fields of open tasks on Today, overdue, due soon or matching the request. Not sent: notes, attachments, worklogs, ids | AI Command plan                                                                                                         |

Two findings shape the design:

1. Of the 12 plugins that send data, the card admits it for **only Todoist**. Each issue
   and calendar provider sends task content through a path with no host declaration.
2. Most plugin traffic cannot be enforced, because plain `fetch` is open to everyone.
   A declaration can be **checked** on the two host paths. Elsewhere it is the author's
   word.

## Prior art

Checked 2026-11-03 against vendor docs.

| Question              | Firefox add-ons ([`data_collection_permissions`](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/), required for new AMO listings since 2025-11-03) | Chrome Web Store ([Privacy practices](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)) | Apple App Privacy / Google Play Data safety |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Where it's declared   | Extension manifest, as fixed data categories                                                                                                                                         | Store dashboard, as checkboxes plus a privacy-policy URL                                                 | Store console, as fixed categories          |
| "Sends nothing"       | Explicit `"none"`, also shown in the prompt                                                                                                                                          | No data types checked                                                                                    | "Data not collected"                        |
| When the user sees it | Install prompt; required data must be accepted                                                                                                                                       | On the listing                                                                                           | On the listing                              |
| On update             | Only **added** categories are shown                                                                                                                                                  | Not shown                                                                                                | Not shown                                   |
| Is it checked?        | No; review only                                                                                                                                                                      | No; certified by the developer                                                                           | No; self-declared                           |

**Take:**

- a fixed vocabulary declared in the manifest
- an explicit "sends nothing"
- disclosure at the moment code would first run
- on update, show only what was added
- a link to each recipient's privacy policy

**Deliberately don't:**

- a dashboard-only declaration, which a ZIP upload never sees
- optional per-category toggles: they add a setting per plugin, and a plugin that needs
  the data cannot work without it
- certification checkboxes: there is no review to certify against

## Design

### 1. Declare: one manifest field

Add one optional field to `PluginManifest` (`packages/plugin-api/src/types.ts`):

```ts
/**
 * What user data this plugin sends off the device. `[]` = sends nothing.
 * Absent = not declared. The host renders this before the plugin first runs.
 */
dataSharing?: PluginDataDestination[];

export interface PluginDataDestination {
  /** Shown as-is, e.g. "GitHub", "Anthropic". */
  recipient: string;
  /** Exact hostnames, same rules as allowedHosts. */
  hosts?: string[];
  /** The user enters the server (self-hosted Gitea, CalDAV, webhook, Ollama). */
  userServer?: boolean;
  data: PluginSharedData[];
  /** 'userAction' = only on an explicit action (search, import, Ask); 'automatic' = polling, hooks. */
  trigger: 'userAction' | 'automatic';
  privacyPolicyUrl?: string;
  termsUrl?: string;
}

export type PluginSharedData =
  | 'credentials' // tokens or passwords the user enters for this recipient
  | 'searchText'
  | 'userText' // free text typed for the recipient, e.g. an AI request
  | 'taskTitles'
  | 'taskNotes'
  | 'taskSchedule' // due dates and times, estimates, free time
  | 'taskStatus' // done state
  | 'timeTracked' // worklogs, time spent
  | 'projectAndTagNames'
  | 'taskIds';
```

Rules:

- **One host list, not two.** `validatePluginManifest` rejects a manifest whose
  `allowedHosts` names a host that no destination's `hosts` covers. So `allowedHosts`
  stays the `request` allowlist, and is always a subset of what the plugin disclosed.
  No new allowlist is added.
- **The vocabulary only grows.** Labels are host translation keys
  (`T.PLUGINS.DATA.<KEY>`). An unknown value fails validation, so a typo cannot hide
  data.
- **Plugins write no free text.** That keeps the notice translated and uniform.
  Plugin-specific detail goes behind AI Command's "Show what would be sent", not into
  the manifest.
- **Recipient terms** come from the URLs. For `userServer`, the dialog says "the server
  you enter, under its operator's terms".

Examples:

- GitHub:
  `{recipient: "GitHub", hosts: ["api.github.com"], userServer: true, data: ["credentials","searchText","taskStatus","taskTitles","taskNotes"], trigger: "automatic", privacyPolicyUrl: "https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement"}`.
  `taskTitles` and `taskNotes` are listed because the user can switch push on; listing
  the maximum keeps the declaration static.
- AI Command: one destination for Anthropic (`api.anthropic.com`, Anthropic's privacy
  policy and terms) and one for a local model server (`userServer: true`).
  `data: ["userText","taskTitles","taskSchedule","projectAndTagNames"]`,
  `trigger: "userAction"`.

### 2. Show: one component, three places

One standalone component, `plugin-data-sharing`, renders a destination list. It shows
the recipient, what is sent, when, and the policy and terms links. It uses plain HTML
per the styling guide.

1. **Before first run: the enable toggle.** `enablePlugin`
   (`plugin-management.component.ts:273`) already blocks on the `nodeExecution` consent.
   Before that, open a `DialogConfirmComponent` with the component inside. OK says
   "Turn on". Cancel resets the toggle, the same way a consent denial does.
   - Shown when `dataSharing` is non-empty, or when it is absent on a non-bundled
     plugin. Absent shows "This plugin doesn't say what data it sends."
   - Not shown for `[]`. Calm default: no dialog for plugins that stay local.
   - AI Command uses this dialog as its "Turn on" step. Its own one-time notice shrinks
     to the "Show what would be sent" preview inside the plugin, so there is no second
     consent.
2. **On the plugin card.** The existing Details block (`plugin-management.component.html:105`)
   gets the same list in place of today's single `CAN_REQUEST_HOSTS` line. It stays
   collapsed: explained where the user looks, not always visible.
3. **In the community listing.** `tools/verify-community-plugins.js:139-184` already
   downloads each pinned ZIP and reads `manifest.json`. It also copies the recipient
   names into an optional `sharesDataWith: string[]` on `CommunityPlugin`
   (`src/app/plugins/util/community-plugin.util.ts:17`), and fails if the copy is stale.
   The listing shows one line, "Sends data to: GitHub", only for entries that send
   something.

### 3. Keep it accurate

| Check                                         | Applies to                         | Enforced?                                                                                                      |
| --------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `allowedHosts` ⊆ declared hosts               | all                                | Yes, manifest validation                                                                                       |
| `PluginAPI.request` host ∈ `allowedHosts`     | all                                | Yes, already (`plugin-bridge.service.ts:586-620`)                                                              |
| `createHttpHelper` host ∈ declared hosts      | plugins that declare `dataSharing` | Yes, new. Skipped when a destination has `userServer: true`, because the configured server varies per provider |
| Every bundled manifest declares `dataSharing` | bundled                            | Yes, a node test next to `electron/bundled-plugin-ids.test.cjs`                                                |
| Declaration matches what the code sends       | bundled                            | Review: a PR that adds a request, push mapping or time-block field updates the manifest                        |
| Plain `fetch`, iframes, links, node scripts   | all                                | **No.** Declared only                                                                                          |

The `createHttpHelper` check is the one new guard. Evidence for it: 9 bundled plugins
send through that path today, and the card shows none of them. The check binds only
plugins that opt in by declaring `dataSharing`. A third-party issue provider that does
not declare keeps today's behaviour, so its contract does not change.

A bundled plugin that starts sending more data ships that behaviour off by default, or
behind its own setting. A bundled update cannot show an added-data dialog, because the
old manifest is not stored.

### 4. Updates and migration

- **Plugin-API and persisted-model changes:** none. The manifest is plugin-side data,
  and `pluginMetadata` (synced, `src/app/op-log/model/model-config.ts:131`) keeps only
  `isEnabled`. Consent is the act of turning the plugin on. It needs no new record and
  no new synced field. No sync rules apply.
- **Already-enabled plugins** are not re-prompted, because they already send. Prompting
  every existing GitHub user once would be noise. The declaration shows on their card
  from the next release.
- **Uploaded or community plugin updates:** the update flow has the old manifest in
  memory before `loadPluginFromZip` replaces the code. If the new `dataSharing` adds a
  recipient or a data type, show only what was added, then keep the plugin enabled or
  leave it disabled. This is Firefox's model.
- **Enabled on another device:** `isEnabled` syncs, so device B loads a plugin that was
  turned on on device A without showing a dialog. The same person consented. This
  differs from `nodeExecution`, which is per device because it grants system access.
- **The two auto-enable migrations** (`plugin.service.ts:150-191`) stay. They re-enable
  an integration the user had already set up.

### 5. What the host can and cannot promise

| Plugin source                 | Enforced                                                                                                 | Declared only                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Bundled                       | Host checks on `request` and the helper. The node test requires a declaration. Review covers each change | `fetch` (automations webhook), links, TTS                     |
| Community-listed (pinned ZIP) | The same two host checks if declared. The verifier keeps the listing line true to the pinned manifest    | Everything else; the code is unreviewed (`COMMUNITY_WARNING`) |
| Uploaded ZIP                  | The same two host checks if declared                                                                     | Everything else                                               |

The dialog and card say this in one line for non-bundled plugins: "Declared by the
author; Super Productivity checks only requests made through the app." Closing the
`fetch` gap would mean a sandbox or a narrower CSP `connect-src`. That is a separate
design and out of scope.

### 6. Policy texts (drafts; every legal and store point needs confirmation)

- **`README.md:95`** keeps the claim and adds what plugins do: "…does NOT collect any
  data. Integrations and plugins you turn on send data directly to the service you
  connect. Each one shows what it sends before it starts."
- **Website privacy policy** (`https://super-productivity.com/privacy/`, linked from
  `src/app/pages/config-page/config-page.component.html:367`; its source is not in this
  repo) gets a section "Integrations and plugins". It says that requests go from the
  device straight to the recipient, that the project receives nothing, and that each
  recipient's own terms apply. It links to a generated table of bundled plugins (phase
  3).
- **SuperSync policy** (`packages/super-sync-server/templates/privacy.template.html`)
  needs no change. It covers the hosted server, which plugin traffic never reaches.
- **Apple 5.1.2(i)** requires apps to "clearly disclose where personal data will be
  shared with third parties, including with third-party AI, and obtain explicit
  permission before doing so". _To confirm:_ that the enable dialog is that explicit
  permission for AI Command. Its OK button must name the action.
- **Apple 4.7 / 2.5.2.** In-app community install exists on native
  (`plugin-management.component.ts:205`). 4.7.3 asks for "explicit consent each time"
  before sharing data with hosted software, and 2.5.2 limits downloaded code. _To
  confirm:_ whether the iOS build may offer community or uploaded plugins at all.
- **Apple App Privacy labels.** _To confirm:_ whether data the app sends directly from
  the device to a service the user configures counts as "collected" by us. Apple
  defines collection as transmitting data off the device in a way that lets the
  developer or its partners access it beyond servicing the request in real time.
- **Google Play Data safety.** "Sharing" excludes transfers "based on a specific
  user-initiated action" and those made "based on a prominent in-app disclosure and
  consent". It explicitly includes data sent off the device by SDKs or libraries in the
  app ([source](https://support.google.com/googleplay/android-developer/answer/10787469)).
  _To confirm:_ whether background polling and two-way sync qualify under the "prominent
  disclosure and consent" exception, given the enable dialog.
- **First-party plugins and the store binary.** Bundled plugins are built into
  `src/assets/bundled-plugins` and ship in the binary, so they count toward the store
  forms. Ship AI Command bundled, not as a download, so store review sees it and the
  labels cover it. _To confirm:_ whether store review treats a bundled but off-by-default
  plugin as app functionality.

## Phases

Each step is paired with its check.

**Phase 1: declare and show** (one PR; needed before AI Command)

1. Add the `dataSharing` type, its validation, and the `allowedHosts` ⊆ hosts rule.
   → verify: specs in `validate-manifest.util.spec.ts` for absent, `[]`, an unknown data
   value, and an uncovered `allowedHosts`.
2. Declare `dataSharing` in all bundled manifests, using the inventory above.
   → verify: a node test fails when a bundled manifest lacks the field. Make it fail
   once before trusting it.
3. Build the `plugin-data-sharing` component, the card block and the enable dialog.
   → verify: a component spec, plus an E2E: enabling a plugin that declares data shows
   the dialog, and cancelling leaves it disabled.
4. Add the added-data dialog for uploaded-plugin updates.
   → verify: a spec with the old and new manifests.

**Phase 2: keep it accurate**

5. Check the host in `createHttpHelper` for declared plugins.
   → verify: a spec in `plugin-http.service.spec.ts`, plus the GitHub, CalDAV and
   Google E2E flows still pass.
6. Make the verifier copy and check `sharesDataWith`; show the listing line.
   → verify: `tools/verify-community-plugins.test.js`.
7. Require `dataSharing` for **new** community listings only; existing entries are
   grandfathered, as Firefox does.
   → verify: a verifier test.

**Phase 3: texts**, after the questions in §6 are confirmed

8. README line, website privacy section, and a bundled-plugin table generated from the
   manifests.
9. Update the store forms (App Store Connect and Play Console; neither is in the repo).
   → verify: a maintainer checklist in the release PR.

## Long-term cost

- **Plugin API:** `dataSharing` and `PluginSharedData` are permanent public surface.
  The vocabulary only grows, and removing a value would break third-party manifests.
  Ten values, each tied to a host translation key.
- **Persisted model and sync wire:** untouched.
- **Maintenance:** every bundled integration change that sends a new field also edits
  its manifest. Review catches it, the node test only checks that the field exists.

## Risks

- **False reassurance.** The list looks authoritative while `fetch` is open. Mitigation:
  the one-line "declared by the author" note on non-bundled plugins, and declaring the
  maximum, not the default.
- **Dialog fatigue.** Mitigation: no dialog for `[]` or for already-enabled plugins, and
  only additions on update.
- **Breaking a third-party issue provider** that declares `dataSharing` but calls an
  undeclared host. That is the intended effect of the check, and only plugins that opt
  in are affected. The error message names the missing host.
- **Store interpretation.** A store may want consent per feature or per send. The
  dialog is the cheapest place to add a per-session step if review demands one.

## Open questions

1. Every item marked _To confirm_ in §6 (legal or store).
2. Gitea, Linear, Trello, Azure DevOps, Redmine, Nextcloud Deck and brain-dump are in
   `BUNDLED_PLUGIN_PATHS` but missing from `packages/plugin-dev/scripts/build-all.js`.
   Confirm what builds them into the release before Phase 1 relies on their manifests.
3. Voice reminder: declare a "speech engine" destination, or restrict it to
   `localService` voices? The plugin does not check that flag today.
4. Enable paths found besides the card are the two migrations and the import menu.
   The import menu activates Todoist and TickTick import in memory
   (`src/app/imex/file-imex/file-imex.component.ts:336-343`), so the dialog has to live
   in one shared function that both callers use. Confirm there is no other path, for
   example through the add-integration dialog.
5. Should automations' webhook URL go through `PluginAPI.request` so it is checked?
   That depends on step 5, and needs a `userServer` exception to the allowlist.
