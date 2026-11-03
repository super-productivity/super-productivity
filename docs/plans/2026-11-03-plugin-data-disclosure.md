# Plugin data disclosure: one way to say what leaves the device

## Objective

One declaration, one rendering. Every plugin says in its manifest what user data it
sends off the device, to whom, and under whose terms. The app renders that statement
where the user already decides: the install dialog, the integration setup dialog, and
the plugin card. No plugin writes its
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
 * Absent = not declared. Shown at install, at integration setup and on the plugin card.
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

/** Ask on each device before this plugin first runs there. Today: AI Command only. */
requiresDataConsent?: boolean;

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
- **`privacyPolicyUrl` must be `https:`.** It renders as a link inside the app, so any
  other scheme is rejected.
- **Plugins write no free text.** Labels are host translation keys
  (`T.PLUGINS.DATA.<KEY>`, `en.json` only), so the notice stays translated and
  uniform. The `userText` label says plainly that it is "whatever you type". The
  `timeTracked` label includes worklog comments.
- **Credentials render first in the recipient's line**, as "**X**: your sign-in, …".
  Phase 1 dropped the separate "Your sign-in for X" line: the recipient prefix already
  says whose sign-in it is, without another branch and key.
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
  Both have `data: ["userText","taskTitles","taskSchedule","projectAndTagNames"]`; the
  Anthropic destination adds `"credentials"` for the user's API key.
- **Parallel Code** declares `[]`: the task id goes to a local app, not off the device.
  **Voice reminder** declares a "System speech engine" destination with `taskTitles`
  until open question 2 is settled, because some voices are online.
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

### 2. Show: one component, in places that already exist

One standalone component, `plugin-data-sharing`, renders a destination list. It shows
the recipient, what is always sent, what is sent only if turned on, and the privacy
policy link. It uses plain HTML. It adds **no new dialog** for ordinary plugins. The
user already gives consent when they connect their own account or install a plugin, and
the declaration is shown at that moment.

1. **Integration setup dialog**, on create only, below the credential fields (above, its privacy link
   would take the dialog's first-tabbable autofocus from them).
   `DialogEditIssueProviderComponent` is the single creation path for plugin issue
   providers (`addIssueProvider`, `dialog-edit-issue-provider.component.ts:253`). Every
   opener goes through it: the issue panel, the provider tab, the setup overview and the
   time-block reconnect. Google OAuth runs inside it (`:404-409`).
2. **Install and update confirmation** for uploaded and community ZIPs. Today
   `_confirmInstall` (`plugin-management.component.ts:565-583`) shows a generic risk list
   before the ZIP is read. The manifest is read only inside `loadPluginFromZip`
   (`plugin.service.ts:1070`), which then installs and, for an enabled plugin, runs the
   new code straight away (`:1222`, `:1345-1350`). Split it: read and validate the
   manifest, show the confirmation with the declaration, then install.
   - **On an update**, compare with the installed manifest. If the declaration changed,
     the block is headed "Changed in this version". No local record is needed.
   - **For a non-bundled plugin**, a missing declaration reads "This plugin doesn't say
     what data it sends". `[]` reads "Says it sends nothing". Both add "Declared by the
     author; Super Productivity can't check it".
3. **Plugin card Details** (`plugin-management.component.html:105-113`), next to
   today's `CAN_REQUEST_HOSTS` line, which stays (`plugin-security.ts:278-283`).
   Replacing it saved one line and needed a branch, so Phase 1 kept both.

**Per-device consent, only where it is required.** A plugin with
`requiresDataConsent: true` (AI Command) gets the component in a dialog before it first
runs on each device. Apple 5.1.2(i) asks for explicit permission before data goes to a
third-party AI. `pluginMetadata.isEnabled` syncs, so a phone that only received a synced
"on" would otherwise send without asking.

- **Record:** a local, unsynced set of consented plugin ids under a new `LS` key
  (`src/app/core/persistence/storage-keys.const.ts:12`), like `nodeExecution` consent.
  No seed is needed: AI Command is new, so nobody has consented yet.
- **Where it asks:** the same places as `checkNodeExecutionPermission`. Both toggle paths
  write the synced flag before loading: the plugin page
  (`plugin-management.component.ts:292-299`) and `enableAndActivatePlugin`
  (`plugin.service.ts:397-403`). Both go through one `PluginService` method that asks
  first, so a "no" never writes `isEnabled`.
- **Synced enable:** `activatePlugin` checks the record before the `'loading'` status is
  set (`plugin.service.ts:526`). At startup it does not prompt: it skips the plugin and
  asks once loading has finished. A "no" stays on this device, in memory, as with
  `_handleNodeExecutionConsentDenied` (`plugin.service.ts:727-752`).
- **AI Command** uses this dialog as its "Turn on" step. Its own notice shrinks to the
  "Show what would be sent" preview. `PluginAPI.openDialog` (`types.ts:705`) takes only
  HTML, so a plugin-built notice could not reuse the translated component; the flag can.

**Accepted, not shown again:**

- An integration whose provider config arrived through sync starts on a second device
  without the setup dialog. The user set it up themselves on the first device.
- Automations and Todoist import have no setup dialog; the user types the webhook URL or
  token in the plugin's own UI. They show the declaration only in card Details.
- Migrations that auto-enable a bundled provider (`plugin.service.ts:146-191`) continue a
  data flow the user set up before this release.
- Turning a bundled integration on from the card sends nothing until credentials are
  entered in the setup dialog.

**The community listing gets no new line or field.** The install confirmation above is
where the user sees it. The alternative, a `sharesDataWith` field on
`community-plugins.json`, would copy the manifest into a second declaration and cost
every author a directory PR per release.

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
  `src/app/op-log/model/model-config.ts:131`) keeps only `isEnabled`. The consent set
  for `requiresDataConsent` plugins lives in local storage, never synced.
- **Existing users** see nothing new until they install, update or set up something, or
  open card Details. Nobody is prompted again.
- **Plugin API:** additive. Older apps ignore both fields, so `minSupVersion` does not
  change. An older app would run AI Command without the consent dialog; AI Command sets
  `minSupVersion` to the release that ships it. Release a new
  `@super-productivity/plugin-api` and document the fields in
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
  obtain explicit permission before doing so." Apple does not define the form of
  "explicit permission" and says nothing about per-device consent. Our reading: an
  affirmative action right next to the disclosure qualifies. For integrations, that
  means the declaration sits beside the button that connects the account, not in a
  collapsed block. Permission given on one device covers the same user's synced setup.
  _To confirm with App Review_; only Apple can settle it.
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
  or SDKs in the app counts. "Collect" means any transmission off the device, to
  whoever receives it, so integration traffic must be declared as **collected** even
  where it is not "sharing". The one related exemption, a user uploading to their own
  Drive or Dropbox account, requires that the app never accesses the data, which does
  not fit task data. Connecting one's own account fits the user-initiated exception
  from sharing. The article attaches nothing to devices or to background sync set up
  earlier, and the form describes the app, not a device. So an integration that arrived
  through sync is covered by the action the user took when setting it up. _To confirm:_
  whether Play agrees that ongoing polling and two-way sync count as that
  user-initiated action.
- **First-party plugins and the store binary.** Bundled plugins are built into
  `src/assets/bundled-plugins` and ship in the binary, so they count toward the store
  forms. _Recommendation, to confirm:_ ship AI Command bundled, not as a download, so
  store review sees it and the labels cover it, and check whether store review treats an
  off-by-default bundled plugin as app functionality.

## Phases

Each step is paired with its check.

**Prerequisite (resolved):** release builds take every plugin dir with a
`package.json` (`packages/build-packages.js` `getPlugins`); `build-all.js` serves only
E2E. A node test in `electron/bundled-plugin-ids.test.cjs` already guards this.

**Phase 1: declare and show** (one PR, before AI Command). Implemented on this
branch: steps 1–3 and 5 except the `plugin-api` release. Step 3 reads the
manifest with `read-zip-manifest.util.ts` instead of splitting `loadPluginFromZip`
(keeps `plugin.service.ts` under its cap), renders through
`plugin-data-sharing.util.ts`, and is covered by util and component specs; the
"Changed in this version" E2E and a card spec are left for a follow-up PR; the
comparison itself is unit-tested. Community installs now download and
verify before the confirmation, so it can show the declaration.

1. Add the `dataSharing` type and its validation: the
   `hosts` rules, the `allowedHosts` cross-check, `https:` privacy links, and unknown
   values as warnings.
   → verify: specs in `validate-manifest.util.spec.ts` covering:
   - `dataSharing` absent, and `[]`
   - `allowedHosts` with no `dataSharing` (still valid)
   - `[]` with `allowedHosts` (rejected)
   - an unknown data value (warning)
   - a bad `hosts` entry (scheme, port or path), a non-`https:` privacy link
2. Declare `dataSharing` in every manifest in `BUNDLED_PLUGIN_IDS`, from the inventory.
   → verify: a node test that fails when one is missing. Make it fail once before
   trusting it.
3. Build `plugin-data-sharing` and render it in the setup dialog, the card Details and
   the install confirmation; split `loadPluginFromZip` so the manifest is read before
   confirming. Add the `en.json` keys.
   → verify: component specs for always / optional / user server / absent / `[]`.
   → verify: E2E. Re-uploading a plugin's ZIP with a new recipient shows "Changed in
   this version" before its code runs; cancel keeps the old version.
4. **Moved to the AI Command PR**, the first plugin that needs it (YAGNI).
   Add `requiresDataConsent`: the local consent set and the check at both enable paths
   and in `activatePlugin`.
   → verify: service specs: ask once per device, deny writes nothing synced, startup
   skips and asks after loading.
   → verify: E2E. A synced enable of a consent plugin asks on the second device before
   it runs.
5. Release `plugin-api` and update the docs (`docs/plugin-development.md`, the wiki).
   → verify: the package's own checks (`packages/README.md`).

**Phase 2: texts**, after the §6 questions are confirmed

6. The README line, the website privacy section, and the bundled-plugin table.
7. The store forms (App Store Connect, Play Console; neither is in the repo).
   → verify: a maintainer checklist in the release PR.

## Long-term cost

- **Plugin API:** `dataSharing`, `optionalData`, `PluginSharedData` and
  `requiresDataConsent` are permanent public surface. The vocabulary only grows.
  Unknown values degrade to "other data" on older clients.
- **Local storage:** one set of plugin ids, bounded by the consent plugins installed.
- **Persisted model and sync wire:** untouched.
- **Maintenance:** a bundled integration that sends a new field also edits its
  manifest. Review catches that; the node test only checks that the field exists.

## Risks

- **False reassurance.** The list looks authoritative while `fetch` is open.
  Mitigations: the "declared by the author" sentence for non-bundled plugins, and
  `optionalData` instead of under-declaring.
- **Seen too late or not at all.** Integrations that arrive through sync, and plugins
  without a setup dialog, show the declaration only in card Details (§2). Accepted:
  the user set them up.
- **Store interpretation.** A store may want explicit consent for integrations too.
  `requiresDataConsent` is the one switch to extend it to more plugins.

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

### Second review

Fresh-context subagent, 2026-11-03. About 35 citations spot-checked; findings 2 and 5
re-verified against the code before applying.

1. **Fixed.** "AI Command is never seeded" was false: a synced `isEnabled` from a newer
   device would be seeded on update. The seed is now limited to a frozen list of
   pre-gate ids (§4).
2. **Fixed.** The plugin-page toggle writes `isEnabled` itself
   (`plugin-management.component.ts:292`), so a gate in `_loadPluginLazy` came too late.
   Both toggle paths now go through one `PluginService` method that asks first (§2.1).
3. **Fixed (accepted).** Seed and first sync both wait on hydration and are not ordered.
   The race is stated, and the frozen list keeps AI Command out of it. The claim that
   a spec pins the ordering is removed.
4. **Fixed.** The activate gate sits before the `'loading'` status, has a mode
   argument, and denies via a named sentinel.
5. **Fixed.** The ZIP gate runs before the old plugin is torn down; a "no" keeps the
   previous version.
6. **Fixed.** `[]` skips the dialog only for bundled plugins.
7. **Fixed.** The card keeps today's hosts line when `dataSharing` is absent.
8. **Fixed.** `privacyPolicyUrl` must be `https:`.
9. **Fixed.** The Anthropic destination declares `credentials`.
10. **Fixed.** Parallel Code declares `[]`. Voice reminder declares the speech engine
    until open question 2 is settled.
11. **Not fixed.** `ids` and `optionalData` stay; both have inventory rows, and §1
    already requires re-checking all nine values before the type is frozen.

### Lean redesign

After the second review the maintainer judged a dialog for every declaring plugin too
inconvenient. A fresh-context subagent checked the leaner design against the code:

1. **Changed.** No new dialog for ordinary plugins. The declaration shows in the
   integration setup dialog (the single creation path for plugin issue providers), the
   install and update confirmation, and card Details. This drops the per-device
   acknowledgement record, the seed and its sync race, the startup deferral and the
   update re-prompt. The earlier review items about those parts are superseded.
2. **Fixed.** `_confirmInstall` showed only generic text before the ZIP was read, and an
   enabled plugin's update ran at once. The plan now splits `loadPluginFromZip` so the
   confirmation shows the declaration, marked "Changed in this version" when it differs.
3. **Fixed.** AI Command still needs per-device consent: a synced `isEnabled` would run it
   on a phone without asking. `requiresDataConsent` keeps a small local consent set for
   flagged plugins only, with no seed.
4. **Fixed.** `PluginAPI.openDialog` takes only HTML, so AI Command could not reuse the
   translated component. The host renders it for flagged plugins.
5. **Accepted, stated in §2.** Integrations that arrive through sync, Automations and
   Todoist import, and migrated providers show the declaration only in card Details.
6. **Not changed.** The reviewer noted the schema is heavy for two or three display
   places. Kept: it is the single source for the store forms and the website table.
