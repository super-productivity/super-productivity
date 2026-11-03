# Plugin data disclosure: one way to say what leaves the device

## Objective

One declaration, one rendering. Every plugin says in its manifest what user data it
sends off the device, to whom, and under whose terms. The app renders that statement
before the plugin first runs on a device, and on the plugin card. No plugin writes its
own privacy notice. This covers bundled plugins, community-listed plugins, uploaded
ZIPs, and the planned AI Command plugin.

Why now: `README.md:95` says the app "does NOT collect any data", and AGENTS.md says
"user data stays local unless explicitly synced". Both are true of the project itself.
But 13 plugins that ship with the app (12 bundled, plus the discover-only AI
productivity prompts) already send user data off the device, and nothing tells the user
so in one consistent place. AI Command adds a third-party AI recipient, which
Apple guideline 5.1.2(i) singles out.

**Deviation from the brief:** the community listing shows nothing new. The user sees
the declaration when they turn an installed plugin on, before its code runs (§2). The
maintainer can overrule this (open question 4).

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
| `nodeExecution`                          | Consent dialog in the main process, stored per device, never synced                                                                                                                                                                                                                          | `src/app/plugins/plugin.service.ts:1739,1777`, `docs/plugin-development.md:769-786`                                                                                                                                                                                                                                |

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
local app. `api-test-plugin` is a development plugin in `BUNDLED_PLUGIN_IDS`; it sends
nothing and declares `[]`. Of the 13 senders, 12 are bundled and one (AI productivity
prompts) is discover-only.

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
- show it again when the declaration changes (Firefox shows only the additions; a full list marked "changed" is simpler)
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
  /** The user enters the server (self-hosted Gitea, CalDAV, webhook, local model). */
  userServer?: boolean;
  /** Sent whenever the plugin is in use. */
  data: PluginSharedData[];
  /** Sent only after the user turns on a plugin setting, e.g. pushing notes. */
  optionalData?: PluginSharedData[];
  privacyPolicyUrl?: string;
}

export type PluginSharedData =
  | 'credentials' // tokens or passwords the user entered for this recipient
  | 'userText' // free text typed for the recipient: search terms, an AI request
  | 'taskTitles'
  | 'taskNotes'
  | 'taskSchedule' // due dates and times, estimates, free time
  | 'taskStatus' // done state
  | 'timeTracked' // worklogs and their comments, time spent
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
  goes in the existing warnings list (`validate-manifest.util.ts:15-19`). The value
  renders as "other data (update the app for details)". Only wrong types are rejected.
- **Plugins write no free text.** Labels are host translation keys
  (`T.PLUGINS.DATA.<KEY>`, `en.json` only), so the notice stays translated and
  uniform. The `userText` label says plainly that it is "whatever you type". The
  `timeTracked` label includes worklog comments.
- **Credentials render apart from content**, as "Your sign-in for X".
- **Always sent vs. optional.** `data` is what goes out as soon as the plugin is used.
  `optionalData` renders as "only if you turn it on". That keeps the declaration
  complete without telling every GitHub user that their notes leave the device; pushing
  notes is off by default (`github-issue-provider/src/plugin.ts:307`).
- **Whose terms:** the recipient's privacy policy URL. For `userServer`, the text is
  "the server you enter, under its operator's terms". There is no `termsUrl`: no
  inventory row needs one.

Examples:

- **GitHub:**
  `{recipient: "GitHub", hosts: ["api.github.com"], userServer: true, data: ["credentials","userText","taskTitles","taskStatus"], optionalData: ["taskNotes"], privacyPolicyUrl: "https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement"}`
  Titles are in `data` because creating an issue sends the title.
- **AI Command:** one destination for Anthropic (`api.anthropic.com`, Anthropic's
  privacy policy), plus a "Your local model server" destination with `userServer: true`.
  Both have `data: ["userText","taskTitles","taskSchedule","projectAndTagNames"]`.
- **AI Command's local model is not reachable today.** `PluginAPI.request` runs through
  the shared HTTP helper without `allowPrivateNetwork`
  (`plugin-bridge.service.ts:572-574`). That helper rejects loopback and private
  addresses (`plugin-http.service.ts:429-434`). `allowedHosts` also cannot name a server
  the user types in. The AI Command plan has to choose a transport, for example the
  bundled-only private-network option that issue providers use
  (`plugin-bridge.service.ts:499`). The disclosure is unaffected:
  `userServer: true` describes it either way.

Before freezing the type, check all nine values against the inventory rows. The list is
permanent public API.

### 2. Show: one component, two places, one gate

One standalone component, `plugin-data-sharing`, renders a destination list. It shows
the recipient, what is always sent, what is sent only if turned on, and the privacy
policy link. It uses plain HTML.

1. **One gate before plugin code first runs on a device.**
   `PluginDataConsentService.confirmDataSharing(manifest)` lives in its own file,
   because `plugin.service.ts` is already over the 1200-line cap. It is called before
   both places that load plugin code:
   - `_loadPluginLazy` (`plugin.service.ts:618`), which every `activatePlugin` path
     reaches: the toggle, startup, the side panel, the import menu
     (`file-imex.component.ts:343`) and the migrations.
   - `loadPluginFromZip` (`plugin.service.ts:1346`), where a re-upload or community
     update of an enabled plugin runs new code.

   On the toggle path, the gate also runs before `setPluginEnabled(true)`. That method is
   synced and is called first today (`plugin.service.ts:397-403`). A "no" therefore never
   writes `isEnabled`.
   - **Saying no stays on this device.** It follows the real
     `_handleNodeExecutionConsentDenied` (`plugin.service.ts:727-752`): the decision is
     kept in memory only, the plugin is not loaded, and the synced `isEnabled` is left
     alone. Other devices are unaffected, and this device asks again on the next start.
     This keeps one user intent to one op: a local "not now" writes nothing.
   - **Startup does not wait on a click.** `_loadEnabledPlugins` awaits each plugin in
     turn (`plugin.service.ts:289-302`). The gate there does not prompt. It skips an
     unacknowledged plugin and, once loading has finished, opens one dialog per pending
     plugin, then loads the ones the user accepts. Other plugins and issue-provider
     polling start as usual.
   - **When it shows:** `dataSharing` is non-empty, or it is absent on a non-bundled
     plugin. The absent case reads "This plugin doesn't say what data it sends".
   - **When it doesn't:** the plugin declares `[]`.
   - **It shows once per device per declaration.** A local, unsynced record maps each
     plugin id to the canonical declaration it was accepted with, stored as a JSON string
     with keys and arrays sorted, or `"absent"`. It lives under a new `LS` key
     (`src/app/core/persistence/storage-keys.const.ts:12`), not in a `MODEL_CONFIGS`
     slice. Per device on purpose: a phone that only received a synced toggle has shown
     nothing, and Apple 5.1.2(i) asks for permission before data goes to a third-party AI.
   - **On any change**, the dialog shows the full list, headed "Changed since you last
     accepted". There is no diffing.
   - **AI Command** uses this dialog as its "Turn on" step. Its own one-time notice
     shrinks to the "Show what would be sent" preview, which the plugin builds, so the
     user gets no second consent.

2. **On the plugin card**, in the existing collapsed Details block
   (`plugin-management.component.html:105`), in place of today's `CAN_REQUEST_HOSTS`
   line. The sentence "Declared by the author; Super Productivity can't check it" goes
   in the dialog and in Details for non-bundled plugins, and nowhere else.

**The community listing gets no new line or field.** Install from the listing shows the
existing risk dialog, then installs the plugin disabled
(`plugin-management.component.ts:441-462`). The declaration appears when the user turns
it on, before its code runs. The user decides after installing, not at the listing. The
alternative was a `sharesDataWith` field on `community-plugins.json`. It would copy the
manifest into a second declaration, cost every author a directory PR per release, and
add an always-visible label.

### 3. Keep it accurate

| Check                                                       | Applies to                | How                                                                                                                                                                                                             |
| ----------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowedHosts` ⊆ declared hosts                             | declaring                 | Manifest validation                                                                                                                                                                                             |
| `PluginAPI.request` host ∈ `allowedHosts`                   | all                       | Already enforced (`plugin-bridge.service.ts:586-620`)                                                                                                                                                           |
| Every plugin in `BUNDLED_PLUGIN_IDS` declares `dataSharing` | bundled and discover-only | A node test next to `electron/bundled-plugin-ids.test.cjs`, iterating `BUNDLED_PLUGIN_IDS` (`bundled-plugins.const.ts`), so the discover-only AI productivity prompts and `api-test-plugin` (`[]`) are included |
| The declaration matches what the code sends                 | bundled                   | Review: a PR that adds a request, a push mapping or a time-block field also edits the manifest                                                                                                                  |
| Issue-provider HTTP, `fetch`, iframes, links, node          | all                       | **Declared only**                                                                                                                                                                                               |

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
- **Seeding existing users.** Without it, everyone would be prompted again for
  integrations they already use. The seed runs once per device, guarded by its own
  local seed-done flag. It runs after store hydration but before the first sync of that
  launch: it waits on `isAllDataLoadedInitially$` only, whereas `_initPlugins` also
  waits for sync (`startup.service.ts:525-540`). It covers only plugins that were already
  enabled in this device's local state. A plugin another device enabled arrives through
  sync after the seed, so it still gets the dialog. AI Command cannot be enabled before
  the release that ships the gate, so it is never seeded.
- **Fresh installs** have no enabled plugins at seed time, so the seed is empty. A
  backup import or `SYNC_IMPORT` that enables plugins later shows dialogs.
- **Migrations** (`plugin.service.ts:146-191`) that auto-enable on a device are seeded
  only if they ran before this release on that device. On a new device they go through
  the gate like any other enable.
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
  dialog counts as that permission for AI Command. Also to confirm: that seeded
  plugins (enabled on that device before this release, none of them AI) need no new
  prompt.
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
  - whether seeded integrations, which never showed the dialog on that device, are
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
2. Declare `dataSharing` in every manifest in `BUNDLED_PLUGIN_IDS`, from the inventory.
   → verify: a node test that fails when one is missing. Make it fail once before
   trusting it.
3. Build `plugin-data-sharing`, `PluginDataConsentService`, the local record with its
   seed, and the card block. Wire the gate into both load sites and ahead of
   `setPluginEnabled(true)`. Add the `en.json` keys.
   → verify: service specs for:
   - show; skip on `[]`; skip when already accepted
   - show again on a changed declaration
   - deny writes nothing synced
   - the seed covers only locally enabled plugins and runs once
     → verify: E2E 1. Enabling a declaring plugin shows the dialog. Cancel leaves it off
     and `isEnabled` unwritten.
     → verify: E2E 2. Re-uploading an enabled plugin's ZIP with a new recipient shows
     the dialog before its code runs.
     → verify: E2E 3. Startup with an unacknowledged enabled plugin loads the other
     plugins first, then asks.
4. Release `plugin-api` and update the docs (`docs/plugin-development.md`, the wiki).
   → verify: the package's own checks (`packages/README.md`).

**Phase 2: texts**, after the §6 questions are confirmed

5. The README line, the website privacy section, and the bundled-plugin table.
6. The store forms (App Store Connect, Play Console; neither is in the repo).
   → verify: a maintainer checklist in the release PR.

## Long-term cost

- **Plugin API:** `dataSharing`, `optionalData` and `PluginSharedData` are permanent
  public surface. The vocabulary only grows. Unknown values degrade to "other data" on
  older clients.
- **Local storage:** one key with a canonical string per plugin id, plus a seed-done
  flag. It stays bounded by the number of installed plugins.
- **Persisted model and sync wire:** untouched.
- **Maintenance:** a bundled integration that sends a new field also edits its
  manifest. Review catches that; the node test only checks that the field exists.

## Risks

- **False reassurance.** The list looks authoritative while `fetch` is open.
  Mitigations: the "declared by the author" sentence for non-bundled plugins, and
  `optionalData` instead of under-declaring.
- **Dialog fatigue.** Mitigations: no dialog for `[]`, the seed for existing users, and
  no dialog at all when nothing changed. A user who enables five plugins on a new phone
  sees five dialogs, which is acceptable for a first run on a device.
- **Seed timing.** If hydration and sync ordering changes in `startup.service.ts`, the
  seed could start including synced enables. The seed spec pins the ordering.
- **Re-prompt on every start after a "no".** That is intended, matching the
  `nodeExecution` deny. A user who wants it gone turns the plugin off, which syncs.
- **Store interpretation.** A store may want consent per feature or per send. The gate
  is the one place to add that.

## Open questions

1. Everything marked _To confirm_ in §6 (legal or store).
2. Voice reminder: declare a "speech engine" destination, or restrict it to
   `localService` voices? The plugin does not check that flag today.
3. Should the automations webhook move to `PluginAPI.request`, so it gets the same
   checks as other plugins? It hits the same private-network and user-server limits as
   AI Command's local model (§1).
4. Should the community listing show recipients after all (§2)?
5. AI Command's transport to a local model (§1). This belongs to the AI Command plan.

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

### Adversarial review

Fresh-context adversarial subagent, 2026-11-03. Each finding was checked against the
code before it was applied.

1. **Fixed.** The plan said a "no" disables the plugin on other devices too. The real
   `nodeExecution` deny is in memory only and never writes the synced `isEnabled`
   (`plugin.service.ts:727-752`). The gate now runs before `setPluginEnabled(true)` on
   the toggle path, a "no" stays local, and the device asks again on the next start
   (§2.1).
2. **Fixed.** A hash cannot show "only what was added". The local record now keeps the
   canonical declaration, and any change shows the full list marked "Changed since you
   last accepted".
3. **Fixed.** The gate is named at both code-load sites (`_loadPluginLazy` at `:618`,
   `loadPluginFromZip` at `:1346`). Startup skips unacknowledged plugins and asks after
   loading, so `_loadEnabledPlugins` never waits on a click. The `nodeExecution`
   citations are corrected to `:1739` and `:1777`.
4. **Fixed (moved).** AI Command's local model cannot be reached through
   `PluginAPI.request`, which blocks loopback and private addresses. The disclosure
   is unaffected; the transport is open question 5, for the AI Command plan.
5. **Fixed.** The seed ran after sync and would have covered plugins another device had
   just enabled. It now runs once per device, after hydration and before sync, on that
   device's enabled set only, with its own seed-done flag. AI Command is never seeded.
6. **Fixed.** Counts: 13 senders (12 bundled, one discover-only), nine data values, and
   `api-test-plugin` added. The node test iterates `BUNDLED_PLUGIN_IDS`.
7. **Fixed.** The per-destination `trigger` is replaced by `optionalData`, which renders
   as "only if you turn it on". The GitHub example now lists notes as optional.
8. **Fixed.** The deviation on the community listing is stated in the Objective.
9. **Fixed.** `termsUrl` dropped; no inventory row needs it.
10. **Fixed.** The `userText` label says "whatever you type", and the `timeTracked`
    label includes worklog comments.
