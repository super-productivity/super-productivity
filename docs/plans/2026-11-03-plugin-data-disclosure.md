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
first runs when the user turns the toggle on (`plugin-meta-persistence.service.ts:36-38`,
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

How the senders were counted: 10 issue and calendar providers send through the
helper. Todoist uses `request`, automations uses `fetch`, and AI productivity prompts
opens a link. That makes **13 plugins that send user data** off the device. Voice
reminder also sends, but only with some voices. Parallel Code passes a task id to a
local app.

Two findings shape the design:

1. Of those 13, the card mentions network access for **only Todoist**. The 10 issue and
   calendar providers send task content through a path that has no host declaration.
2. The host cannot enforce most plugin traffic, because plain `fetch` is open to every
   plugin. The declaration is mostly the author's word. Only `PluginAPI.request` is
   checked.

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

Add one optional field to `PluginManifest` (`packages/plugin-api/src/types.ts:168`):

```ts
/**
 * What user data this plugin sends off the device. `[]` = sends nothing.
 * Absent = not declared. The host shows this before the plugin first runs on a device.
 */
dataSharing?: PluginDataDestination[];

export interface PluginDataDestination {
  /** Shown as-is, e.g. "GitHub", "Anthropic". */
  recipient: string;
  /** Exact hostnames, validated like allowedHosts. */
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
  | 'credentials' // tokens or passwords the user entered for this recipient
  | 'userText' // text typed for the recipient: search terms, an AI request
  | 'taskTitles'
  | 'taskNotes'
  | 'taskSchedule' // due dates and times, estimates, free time
  | 'taskStatus' // done state
  | 'timeTracked' // worklogs, time spent
  | 'projectAndTagNames'
  | 'ids'; // task, project or tag ids
```

Rules:

- **One host list, not two.** `allowedHosts` stays the only allowlist, for `request`.
  The cross-check runs only when `dataSharing` is present: every `allowedHosts` entry
  must appear in some destination's `hosts`. `dataSharing: []` together with non-empty
  `allowedHosts` is rejected as a contradiction. A manifest with `allowedHosts` and no
  `dataSharing` validates exactly as it does today, so existing third-party plugins keep
  working.
- **Unknown values warn; they don't reject.** A plugin built for a newer app may use a
  value an older client does not know, and mobile clients update slowly. The warning
  goes in `manifestValidation.warnings`, and the value renders as "other data (update
  the app for details)". Only wrong types are rejected.
- **Plugins write no free text.** Labels are host translation keys
  (`T.PLUGINS.DATA.<KEY>`, `en.json` only), so the notice stays translated and
  uniform. Plugin-specific detail stays inside the plugin, such as AI Command's "Show
  what would be sent", which the plugin builds itself.
- **Credentials render apart from content**, as "Your sign-in for X". They are not user
  content, but they do leave the device.
- **Terms of service** come from the URLs. For `userServer`, the text is "the server you
  enter, under its operator's terms".
- **Declare the maximum** a user can turn on, not the default. A static declaration
  must not under-state what the plugin can send.

Examples:

- **GitHub:**
  `{recipient: "GitHub", hosts: ["api.github.com"], userServer: true, data: ["credentials","userText","taskStatus","taskTitles","taskNotes"], trigger: "automatic", privacyPolicyUrl: "https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement"}`
- **AI Command:** one destination for Anthropic (`api.anthropic.com`, with its privacy
  policy and terms URLs), plus a "Your local model server" destination with
  `userServer: true`. `data: ["userText","taskTitles","taskSchedule","projectAndTagNames"]`,
  `trigger: "userAction"`.

Before freezing the type, check all ten values against the inventory rows. The list is
permanent public API.

### 2. Show: one component, two places, one gate

One standalone component, `plugin-data-sharing`, renders a destination list. It shows
the recipient, what is sent and when, and the policy and terms links. It uses plain HTML.

1. **One gate before plugin code first runs on a device.** A new
   `PluginDataConsentService` lives in its own file, because `plugin.service.ts` is
   already over the 1200-line cap. Its `confirmDataSharing(manifest)` is called where
   `PluginService` loads plugin code, next to the existing `checkNodeExecutionPermission`
   (`plugin.service.ts:397-451`). That covers every path at once:
   - the toggle
   - startup of a plugin that sync enabled
   - re-upload of an enabled plugin
   - the import menu (`file-imex.component.ts:336-343`)
   - the migrations

   It shows a `DialogConfirmComponent` with the list. OK reads "Turn on". Deny follows
   the `nodeExecution` pattern (`_handleNodeExecutionConsentDenied`,
   `plugin.service.ts:740`): the plugin is disabled, and since `isEnabled` syncs, it is
   disabled on other devices too, as today.
   - **When it shows:** `dataSharing` is non-empty, or it is absent on a non-bundled
     plugin. The absent case reads "This plugin doesn't say what data it sends".
   - **When it doesn't:** the plugin declares `[]`.
   - **It shows once per device per declaration.** A local, unsynced record keeps a hash
     of the acknowledged `dataSharing` per plugin id. It goes in a new `LS` key
     (`src/app/core/persistence/storage-keys.const.ts:12`), not in a `MODEL_CONFIGS`
     slice. Per device on purpose, like `nodeExecution`: a phone that only received a
     synced toggle has shown nothing, and Apple 5.1.2(i) asks for permission before data
     goes to a third-party AI.
   - **On a changed hash**, the dialog shows only what was added, Firefox-style. This
     covers uploaded, community and bundled updates alike, and needs no manifest diff
     inside `loadPluginFromZip`.
   - **AI Command** uses this dialog as its "Turn on" step. Its own one-time notice
     shrinks to the "Show what would be sent" preview, so the user gets no second
     consent.

2. **On the plugin card**, in the existing collapsed Details block
   (`plugin-management.component.html:105`), in place of today's `CAN_REQUEST_HOSTS`
   line. The sentence "Declared by the author; Super Productivity can't check it" goes
   in the dialog and in Details for non-bundled plugins, and nowhere else.

**The community listing gets no new line or field.** Install from the listing already
downloads the ZIP into a disabled plugin (`plugin-management.component.ts:441-462`), and
the gate shows the declaration before its code runs. That is where the user decides.
The alternative was a `sharesDataWith` field on `community-plugins.json`. It would copy
the manifest into a second declaration, cost every author a directory PR per release,
and add an always-visible label. The brief asks for the listing, so this is a
deliberate deviation. The maintainer can overrule it.

### 3. Keep it accurate

| Check                                              | Applies to | How                                                                                            |
| -------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `allowedHosts` ⊆ declared hosts                    | declaring  | Manifest validation                                                                            |
| `PluginAPI.request` host ∈ `allowedHosts`          | all        | Already enforced (`plugin-bridge.service.ts:586-620`)                                          |
| Every bundled manifest declares `dataSharing`      | bundled    | A node test next to `electron/bundled-plugin-ids.test.cjs`                                     |
| The declaration matches what the code sends        | bundled    | Review: a PR that adds a request, a push mapping or a time-block field also edits the manifest |
| Issue-provider HTTP, `fetch`, iframes, links, node | all        | **Declared only**                                                                              |

There is no new runtime host guard on `createHttpHelper`. The helper has no plugin
context, and the sync-adapter factory receives it as a callback with no plugin context
(`plugin-sync-adapter.service.ts:80-86`). Every self-hosted provider would need a
`userServer` exemption anyway, and `fetch` stays open. The guard would bind only
fixed-host plugins that are already reviewed. No observed instance of declaration drift
justifies it yet ([hardening needs evidence](../hardening-earns-its-place.md)). Record it
as a gap instead.

### 4. Migration

- **Persisted model and sync:** no change. `pluginMetadata` (synced,
  `src/app/op-log/model/model-config.ts:131`) keeps only `isEnabled`. The
  acknowledgement record lives in local storage, never synced, like `nodeExecution`
  consent.
- **Already-enabled plugins:** the first launch of the release seeds an acknowledgement
  for each plugin that is enabled on that device, so no one is re-prompted for an
  integration they already use. Plugins enabled later, including by sync, show the
  dialog on first load on each device.
- **Bundled plugins that later widen what they send** get the "added" dialog through the
  hash. No special rule is needed.
- **Plugin API:** additive. Older apps ignore the field, so `minSupVersion` does not
  change. Release a new `@super-productivity/plugin-api` and document the field in
  `docs/plugin-development.md` and the wiki "Develop a Plugin" page.

### 5. What the host can and cannot promise

| Plugin source                 | Enforced                                                                                                | Declared only                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Bundled                       | The `request` allowlist; the node test requires a declaration; review per change                        | Issue-provider HTTP, `fetch`, links, TTS                      |
| Community-listed (pinned ZIP) | The `request` allowlist; the ZIP is hash-pinned to the listed version (`community-plugin.util.ts:1-14`) | Everything else; the code is unreviewed (`COMMUNITY_WARNING`) |
| Uploaded ZIP                  | The `request` allowlist                                                                                 | Everything else                                               |

Closing the `fetch` gap needs a sandbox or a narrower CSP `connect-src`. That is a
separate design and out of scope.

### 6. Policy texts (drafts; every legal and store point needs confirmation)

- **`README.md:95`** keeps the claim and adds what plugins do: "…does NOT collect any
  data. Integrations and plugins you turn on can send data directly to the service you
  connect; each plugin's details list what it sends."
- **Website privacy policy** (`https://super-productivity.com/privacy/`, linked from
  `src/app/pages/config-page/config-page.component.html:367`; its source is not in this
  repo) gets a section "Integrations and plugins". It says that requests go from the
  device straight to the recipient, that the project receives nothing, and that each
  recipient's terms apply. It links to a table of bundled plugins generated from their
  manifests.
- **SuperSync policy** (`packages/super-sync-server/templates/privacy.template.html`)
  needs no change. It covers the hosted server, which plugin traffic never reaches.
- **Apple 5.1.2(i)** (guideline text read 2026-11-03): "You must clearly disclose where
  personal data will be shared with third parties, including with third-party AI, and
  obtain explicit permission before doing so." _To confirm:_ that the per-device gate
  dialog counts as that permission for AI Command. Also to confirm: that plugins enabled
  before this release need no new prompt. They are seeded, not asked.
- **Apple 4.7 / 2.5.2.** Native builds can install community plugins in the app
  (`plugin-management.component.ts:205`). 4.7.3 asks for "explicit consent each time"
  before data is shared with hosted software, and 2.5.2 limits downloaded code. _To
  confirm:_ whether the iOS build may offer community or uploaded plugins at all.
- **Apple App Privacy labels.** _To confirm:_ whether data sent from the device straight
  to a service the user configures counts as "collected" by us. Apple's definition
  hinges on access "for a period longer than necessary to service the transmitted
  request in real time".
- **Google Play Data safety.** The help article, read 2026-11-03
  ([source](https://support.google.com/googleplay/android-developer/answer/10787469)),
  excludes from "sharing" any transfer "based on a specific user-initiated action" where
  the user "reasonably expects the data to be shared". It also excludes a transfer "based
  on a prominent in-app disclosure and consent". Data sent off the device by libraries
  or SDKs in the app counts. _To confirm:_
  - whether background polling and two-way sync fall under the disclosure-and-consent
    exception
  - whether integrations that migrations enabled, and that never showed the dialog, are
    covered
- **First-party plugins and the store binary.** Bundled plugins are built into
  `src/assets/bundled-plugins` and ship in the binary, so they count toward the store
  forms. _Recommendation, to confirm:_ ship AI Command bundled, not as a download, so
  store review sees it and the labels cover it, and check whether store review treats an
  off-by-default bundled plugin as app functionality.

## Phases

Each step is paired with its check.

**Prerequisite:** confirm how Gitea, Linear, Trello, Azure DevOps, Redmine, Nextcloud
Deck and brain-dump get into the release. They are in `BUNDLED_PLUGIN_PATHS` but missing
from `packages/plugin-dev/scripts/build-all.js`. Step 2 relies on their manifests.

**Phase 1: declare and gate** (one PR, before AI Command)

1. Add the `dataSharing` type and its validation: the `hosts` rules, the `allowedHosts`
   cross-check, and unknown values as warnings.
   → verify: specs in `validate-manifest.util.spec.ts` covering:
   - `dataSharing` absent, and `[]`
   - `allowedHosts` with no `dataSharing` (still valid)
   - `[]` with `allowedHosts` (rejected)
   - an unknown data value (warning)
   - a bad `hosts` entry (scheme, port or path)
2. Declare `dataSharing` in every bundled manifest, from the inventory.
   → verify: a node test that fails when one is missing. Make it fail once before
   trusting it.
3. Build `plugin-data-sharing`, `PluginDataConsentService`, the local acknowledgement
   record with its first-launch seed, and the card block. Add the `en.json` keys.
   → verify: service specs for show, skip on `[]`, skip when acknowledged, show added
   items only, seed, and deny-disables.
   → verify: E2E 1. Enabling a declaring plugin shows the dialog, and cancel leaves it
   off.
   → verify: E2E 2. Re-uploading a ZIP with an added recipient shows only that
   recipient.
4. Release `plugin-api` and update the docs (`docs/plugin-development.md`, the wiki).
   → verify: the package's own checks (`packages/README.md`).

**Phase 2: texts**, after the §6 questions are confirmed

5. The README line, the website privacy section, and the bundled-plugin table.
6. The store forms (App Store Connect, Play Console; neither is in the repo).
   → verify: a maintainer checklist in the release PR.

## Long-term cost

- **Plugin API:** `dataSharing` and `PluginSharedData` are permanent public surface.
  The vocabulary only grows. Unknown values degrade to "other data" on older clients.
- **Local storage:** one key holding a hash per plugin id. It stays bounded by the
  number of installed plugins.
- **Persisted model and sync wire:** untouched.
- **Maintenance:** a bundled integration that sends a new field also edits its
  manifest. Review catches that; the node test only checks that the field exists.

## Risks

- **False reassurance.** The list looks authoritative while `fetch` is open.
  Mitigations: the "declared by the author" sentence for non-bundled plugins, and
  declaring the maximum.
- **Dialog fatigue.** Mitigations: no dialog for `[]`, the seed for existing users, and
  only additions on change. A user who enables five plugins on a new phone sees five
  dialogs. That is acceptable for a first run on a device.
- **The seed hides a gap.** A device that receives a synced enable before it updates
  gets seeded without having seen anything. That window is small.
- **Store interpretation.** A store may want consent per feature or per send. The gate
  is the one place to add that.

## Open questions

1. Everything marked _To confirm_ in §6 (legal or store).
2. Voice reminder: declare a "speech engine" destination, or restrict it to
   `localService` voices? The plugin does not check that flag today.
3. Should the automations webhook move to `PluginAPI.request`, so it gets the same
   checks as other plugins? It would need a `userServer` exception to the allowlist.
4. Should the community listing show recipients after all (see §2)?

## Review

Fresh-context subagent review, 2026-11-03. The reviewer spot-checked about 25
citations and found none wrong. Findings and what happened to them:

1. **Fixed.** A device that only received a synced enable sent data without ever
   showing a dialog, which matters for Apple 5.1.2(i). Fix: a per-device acknowledgement
   in local storage, not synced (§2.1, §4).
2. **Fixed.** The update dialog had no place to live: the new manifest only exists
   inside `loadPluginFromZip`, which loads enabled code straight away. Fix: one gate at
   code load, with a hash of the declaration, so no diff is needed in the ZIP path. It
   lives in its own service because `plugin.service.ts` is over the line cap.
3. **Fixed (removed).** The `createHttpHelper` host guard. It has no plugin context, it
   is exempt for every self-hosted provider, and there is no evidence of drift. It is
   now recorded as a gap (§3).
4. **Fixed.** The `allowedHosts` cross-check now runs only when `dataSharing` is
   present. `[]` together with hosts is rejected.
5. **Fixed.** Unknown data values now warn and render as "other data" instead of
   failing on older clients.
6. **Fixed.** The gate moved from `enablePlugin` to `PluginService` code loading,
   covering all enable paths. The cited line changed to
   `plugin-meta-persistence.service.ts:36-38`, because the comment at
   `plugin.service.ts:1222` is stale.
7. **Fixed.** Migrated and seeded plugins never see the dialog. This is now a _to
   confirm_ item under Play and Apple (§6), plus a risk.
8. **Fixed.** Vocabulary: `searchText` merged into `userText`, `taskIds` widened to
   `ids`, credentials shown apart from content, and the rule "declare the maximum" is
   explicit.
9. **Fixed.** Phase 1 step 4 now releases `plugin-api` and updates the docs.
   `minSupVersion` is unchanged.
10. **Fixed.** The `sharesDataWith` listing field is dropped. The dialog after a
    community install is the disclosure. This deviates from the brief; see open
    question 4.
11. **Fixed.** The "declared by the author" sentence now appears only in the dialog and
    in the card Details, and there is no listing label.
12. **Fixed.** The count of senders is now explained (13), and the helper users
    corrected to 10.
13. **Fixed.** README wording no longer promises a prompt for every plugin. The Play
    and Apple quotes are dated. Bundling AI Command is marked as a recommendation to
    confirm.
14. **Fixed.** The rule requiring `dataSharing` for new community listings is dropped.
    The `build-all.js` gap is now a prerequisite, not an open question.
15. **Partly fixed.** Added: `hosts` validation specs, `en.json` keys, an E2E for the
    update flow, and a note that "Show what would be sent" is built by the plugin.
    **Not fixed:** a separate inventory of plugin iframe traffic. It falls under
    "declared only" with `fetch`, and tracing it would not change the design.
