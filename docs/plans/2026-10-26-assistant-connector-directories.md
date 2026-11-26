# Assistant connector: from capture to planning

Oct 26, 2026 · rev. 2 · status: M1, M2 and M2b implemented on
`ccr-b970e295-wfh8kn`, not yet merged; M3–M5 deferred or gated. Rev. 2 follows
a fresh-context adversarial review; § Review lists what it changed.

Make Super Productivity (SP) a strong answer to "connect a task manager to my AI
assistant", for people who care about privacy and time tracking. We control
quality, not placement: the platforms decide what gets featured in their
directories. So this is a product investment first. Directory submissions come
second.

It builds on, and in places revises, two plans that already shipped in v19.3.0
(Oct 23):

- [Local desktop MCP](2026-09-22-local-desktop-mcp.md) (#10251)
- [Agent task capture](2026-10-11-agent-task-capture.md) (#10759, #10785, #10829)

§5 lists every earlier decision this plan touches and whether it keeps or
reverses it.

**Decision.**

1. **Now:** make both endpoints directory-ready and submittable:
   - tool annotations and server metadata (M1)
   - a privacy-policy section, the `.mcpb` as a release asset, an in-app link
     to it, and a hosted MCP Registry entry (M2)
   - a durable sign-in path for directory reviewers (M2b)
2. **Deferred:** local editing tools (M3) and a time summary (M4). They need a
   local demand signal first (§1). §6.3 and §6.4 record what the review found
   they must get right when they come back.
3. **Gated:** remote reading and editing for cloud assistants, as a relay to
   the user's own running app (M5).
4. **Rejected:** a server-side headless client.

---

## 1. Goal and what "done" means

- **Reach.** SP is listed in Claude's connector directory (Community label), in
  the official MCP Registry, and is submitted to ChatGPT's plugin directory.
- **Quality.** The scenarios in §6.7 that the shipped tools cover work end to
  end: the local endpoint against Claude Code, Codex and Claude Desktop, the
  hosted one against claude.ai and ChatGPT.
- **Uptake signal for M5, without telemetry.** A count of capture grants per
  client name, and how many were used in the last 30 days (`lastUsedAt`). It is
  aggregate only, and the privacy section discloses it (§6.2).
- **Demand signal for M3 and M4.** The hosted count cannot show demand for local
  tools, so these need their own signal: issues, discussions or release-note
  replies asking for assistant editing or time questions. Each must come from a
  distinct participant, as the review guide counts demand.

## 2. Where we are (v19.3.0)

| Surface                                                                | Reaches                                                                                      | Tools                                                                                | Auth                                                                       | Account          |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ---------------- |
| Hosted `/mcp` on SuperSync (`packages/super-sync-server/src/capture/`) | Every client, including claude.ai web and mobile, ChatGPT, and Claude Code cloud sessions    | `create_task` only. It is write-only; items are sealed and imported on the next sync | OAuth with a connect code (Claude, Claude Code, ChatGPT); `sp_cap_` tokens | SuperSync (beta) |
| Local `/mcp` on the desktop app (`electron/mcp/`), at `127.0.0.1:3876` | Clients on the same computer: Claude Code, Codex, Cursor, and Claude Desktop through `.mcpb` | `get_status`, `list_tasks`, `get_task`, `list_projects`, `list_tags`, `create_task`  | `sp_mcp_` key and three scopes                                             | None             |
| Local REST API (`electron/local-rest-api.ts`)                          | Scripts, Parallel Code                                                                       | Full task CRUD, start/stop tracking, time logging                                    | REST token, all or nothing                                                 | None             |

Gaps in what shipped, and their status on this branch:

- **Annotations.** The local tools had none. The hosted `create_task` had no
  `title`, `idempotentHint` or `openWorldHint`. Fixed in M1.
- **The `.mcpb` is not published anywhere,** and its manifest has no icon. Fixed
  in M2.
- **The SuperSync privacy policy** (`templates/privacy.template.html`) did not
  mention AI assistants. This was M4 of the capture plan, still open. Written
  in M2; it needs legal review before deploy.
- **The hosted instance may be behind.** It answered a claude.ai session on
  Oct 26 with a `create_task` that had only `title` and `notes`, while v19.3.0
  ships `dueDate`, `dueTime` and `repeat`. Either the instance is older than
  #10829, or Claude cached the tool list. Operator check.
- **No MAS entitlement.** Mac App Store builds cannot listen on the port; the
  entitlement was deferred to its own release (09-22 plan, §3). Unchanged.
- **Reviewers cannot sign in.** OAuth needs a 10-minute, single-use connect code
  from a running app. Claude's "test credentials" and ChatGPT's "test account
  without MFA" cannot work with that. Fixed in M2b.

Parallel Code (johannesjo/parallel-code, MIT, ~1.1k★) already closes the
execute-and-track loop locally through the REST API:

- It creates a matching SP task when a task is first focused.
- It sets SP's current task, so SP tracks the time.
- It keeps titles in sync and marks the task done on merge.

The plan step, where an assistant plans the day in SP, needs read access plus
edits. Locally that means M3; for cloud assistants it means M5.

## 3. Facts checked on Oct 26, 2026

The confidence labels follow `docs/market/README.md`: **read** means the
primary page was read; **snippet** means only a search excerpt was available.
OpenAI's and modelcontextprotocol.io's hosts were blocked from the research
sandbox. The registry docs and schema were read from GitHub and
static.modelcontextprotocol.io instead.

**Claude connector directory (read)**

- **Sources.** claude.com/docs/connectors/building/{submission,
  review-criteria, authentication, mcpb}.md, and the Software Directory Policy
  (support article 13145358).
- **Submission.** Through the portal at claude.ai/directory/manage. The
  submitter needs a paid plan. An automated policy scan lists the server as
  **Community** by default. Anthropic then automatically escalates "highly
  useful" listings to **Verified** review, where reviewers test each tool.
- **Required:**
  - Every tool has a `title` plus `readOnlyHint: true` (read tools) or
    `destructiveHint: true` (tools that "modify or delete data").
  - Read and write are separate tools. Tool names are at most 64 characters.
  - OAuth through DCR or CIMD with S256 PKCE. CIMD needs
    `client_id_metadata_document_supported` and `none` among the token auth
    methods.
  - A 401 carries `resource_metadata`.
  - Test credentials for a fully populated account.
  - Public docs by the publish date, a privacy-policy URL, a support contact
    and an icon.
  - At least three working example prompts (policy §3E).
  - The server domain should match the service.
- **Not accepted:** money transfer, and AI media generation.
- **Annotations drive auto-permissions.** Read-only tools run without asking;
  destructive tools always prompt.
- **Several URLs per listing are Verified-only.** A listing whose users connect
  to different URLs, such as self-hosted servers, needs the Verified label.
- **Desktop extension listings are deprecated.** "The directory no longer
  accepts MCPB submissions." A local server reaches the directory only inside
  a plugin. Plugin local servers load in Claude Code and local Cowork, not in
  Chat. A `.mcpb` is still installed by double-click.

**ChatGPT (snippet only)**

- **Rename.** The app directory became the ChatGPT/Codex **Plugin directory**
  on 2026-07-09.
- **Before submitting:**
  - Identity verification.
  - A public HTTPS server on your own domain.
  - A domain token at `/.well-known/openai-apps-challenge`.
  - A project with global data residency. EU-residency projects cannot submit
    MCP plugins.
- **Annotations.** All three hints as explicit booleans. `destructiveHint`
  is false only for additive writes, and `openWorldHint` is false for a private
  workspace.
- **Submission package:**
  - 5 positive and 3 negative test cases
  - a demo video
  - privacy, terms, support and website URLs
  - a test account without MFA
- **UI is optional.** A widget is not required, and tools-only servers are a
  documented path.
- **Plans (unverified).** Custom write connectors may be limited to Business,
  Enterprise and Edu. If so, a listing is the only route for consumer users.

**Official MCP Registry (read)**

- **Status.** Preview; API frozen at v0.1. Published with the `mcp-publisher`
  CLI. Versions are immutable, and an entry is at most 4 KB.
- **Namespaces.** `io.github.<org>/*` through GitHub Actions OIDC (the workflow
  needs `id-token: write`), or a domain namespace verified by a DNS TXT record
  or `/.well-known/mcp-registry-auth`.
- **Remote servers.** A `remotes` entry (`streamable-http`) may declare required
  secret headers with a `{variable}` value. A URL belongs to one name.
- **`.mcpb` packages.** They must be hosted on GitHub or GitLab releases, the
  URL must contain "mcp", and `fileSha256` is required.
- **`mcp-publisher` v1.8.1.** The `linux_amd64` archive's SHA-256 is
  `a06c9096…cf2cc`, matching the release's `registry_1.8.1_checksums.txt`.
- **Downstream (snippet).** GitHub's MCP registry (VS Code `@mcp`) and Glama
  build on it. Docker's catalog takes a PR. Smithery lists servers by URL.
  PulseMCP has paused submissions.

**Competitors (Claude listings read; ChatGPT snippet)**

- **Claude directory, all "Anthropic verified"** and all read and write:
  Todoist (27 tools), TickTick (92), Linear, Notion and ClickUp (including
  timer start/stop and time entries). Asana is mostly read, plus
  `update_task`.
- **ChatGPT:** Notion, Todoist, TickTick, Asana, ClickUp, Linear and Trello.
- **Official servers outside both directories:** Sunsama, Any.do, Akiflow
  (snippet).
- **No official server:** Toggl, Clockify, Motion, Microsoft To Do, Things.

**So the shelf is not empty for todo apps.** No dedicated time tracker is
listed; ClickUp is the only listing with time tools. Nothing listed is
open-source, local-first or account-free.

## 4. Prior art

| App      | Read / write                          | Time tracking tools              | Delete        | Account / price                                 | Where data lives |
| -------- | ------------------------------------- | -------------------------------- | ------------- | ----------------------------------------------- | ---------------- |
| Todoist  | Both, 27 tools                        | None found                       | Yes (snippet) | Account; free tier                              | Vendor cloud     |
| TickTick | Both, 92 tools                        | Focus records (snippet)          | Yes (snippet) | Account; free tier                              | Vendor cloud     |
| ClickUp  | Both                                  | Start/stop timer, add time entry | Yes (snippet) | Account; Free capped at 100 calls/day (snippet) | Vendor cloud     |
| Asana    | Mostly read, `update_task`            | None                             | No (read)     | Account                                         | Vendor cloud     |
| Sunsama  | Official server, not listed (snippet) | Unknown                          | Unknown       | Paid account                                    | Vendor cloud     |

Sources: claude.com/marketplace/connectors pages (read, 2026-10), and vendor
pages and community lists (snippet, 2026-09/10). Nothing was tested hands-on.

**Take:**

- Separate tools per action.
- Time tracking as tools, when M3 and M4 return.
- Privacy and "your data stays on your devices" as the pitch.

**Deliberately don't:**

- **A 90-tool surface.** Every tool is permanent public contract and prompt
  surface.
- **Delete, archive and bulk tools.**
- **Project and tag creation.**
- **Any vendor-cloud copy of the user's data.**

Scorecard rows: dimension 1 (quick capture, must not lose badly), 7 (time
tracking, must be best), 15 (extensibility, tracked), 19 (privacy, must be
best) and 21 (AI, open decision). This round improves rows 1, 15 and 19
(capture reach, distribution, privacy disclosure); row 7 waits for M4. It does
not try to close the AI row by building an assistant.

## 5. What earlier plans decided, and what changes

| #   | Earlier decision (source)                                                                                                    | This plan                                                                                                                            | Why                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "Editing is out of scope until usage shows a need" (09-22, Decision)                                                         | **Kept.** Rev. 1 proposed reversing it; M3 is deferred                                                                               | The review guide wants new evidence for a reversal, and none was new. The community CRUD servers were already the 09-22 evidence, and Parallel Code already runs this loop over REST. Local servers cannot be listed in any directory (§3), so M3 adds nothing to reach                                                                     |
| 2   | Reads forward to the existing REST routes; capture uses its own internal route (09-22, §5)                                   | **Kept.** When M3 returns, edits use internal `/assistant/*` routes that call a scheduling service shared with the task context menu | REST `PATCH` sets `dueDay` through a generic `updateTask`. The menu keeps a task's time when moving it to another day and does nothing when it is already due that day (`task-context-menu-inner.component.ts:800–850`), while `planTaskForDay` clears the time (`task.reducer.ts:738–748`). Only shared code makes "same as the menu" true |
| 3   | "Only active tasks … the archive is never exposed" (09-22, §Tools; wiki 3.01)                                                | **Kept.** M4 is deferred; as designed it is a partial reversal (archived totals)                                                     | §6.4                                                                                                                                                                                                                                                                                                                                        |
| 4   | No `instructions` in `initialize` (09-22, §Protocol)                                                                         | **Kept**                                                                                                                             | Tool descriptions carry the domain rules; one less public string                                                                                                                                                                                                                                                                            |
| 5   | `.mcpb` release asset and in-app download are follow-ups (09-22, §.mcpb, §8)                                                 | **Done now** (M2), packed with `fflate` as before                                                                                    | Claude Desktop users have no other route. Rev. 1's hand-written zip writer was an unlisted reversal of 09-22's "fflate, already a root dependency"; the Linux release job already installs dependencies (`build.yml:107`)                                                                                                                   |
| 6   | MAS `network.server` entitlement in its own release, after a dev-build check (09-22, §3, §8)                                 | **Unchanged.** The in-app `.mcpb` link shows only on Windows and on the macOS direct download                                        | A Mac App Store build cannot listen yet, and Claude Desktop has no Linux build                                                                                                                                                                                                                                                              |
| 7   | Hosted path only for capture (10-11, Decision 1)                                                                             | **Kept**                                                                                                                             | —                                                                                                                                                                                                                                                                                                                                           |
| 8   | "Out of scope: reading tasks remotely, editing …, server-created ops" (10-11)                                                | **Kept.** M5 designs remote read and edit as a relay that runs on the user's device and is **gated**                                 | The relay is the only remote design that keeps the pitch true; its cost (§6.5) needs uptake evidence first                                                                                                                                                                                                                                  |
| 9   | The headless client "stays deferred" as the path to remote read (10-11, Decision)                                            | **Rejected** for directory use                                                                                                       | It needs the user's key and full plaintext state on the server, plus reducer extraction (~240 files)                                                                                                                                                                                                                                        |
| 10  | `create_task` annotations `readOnlyHint: false, destructiveHint: false` (10-11, §Tool contract)                              | Add `title`, `idempotentHint: false` and `openWorldHint: false` (M1). `destructiveHint` stays false (§6.1)                           | Claude needs `title`; ChatGPT needs all three hints explicitly                                                                                                                                                                                                                                                                              |
| 11  | M4: wiki per client, privacy-policy addition, release notes, enable on the hosted server (10-11, Milestones)                 | The privacy-policy section is written here. Redeploying stays an operator step                                                       | Both directories need a privacy-policy URL. The hosted instance already runs with `CAPTURE_CONNECTOR_ENABLED`, so the section goes live on the next deploy: legal review comes first                                                                                                                                                        |
| 12  | Connect code and client allowlist instead of server sign-in (10-11, Decision 5)                                              | **Kept, plus** an operator-set reviewer code bound to one demo account (M2b)                                                         | Directory reviewers test days later from vendor infrastructure, so a 10-minute code from a running app cannot work. Server sign-in would still need the login-then-continue flow the 10-11 plan avoided                                                                                                                                     |
| 13  | "No shared package until a second user exists" (10-11, §/mcp)                                                                | **Kept**                                                                                                                             | The relay (M5) would be that second user                                                                                                                                                                                                                                                                                                    |
| 14  | Market page: "AI: built-in assistant, or only external assistants through MCP" is an open decision (`docs/market/README.md`) | **Assumes "external assistants through MCP"**                                                                                        | Proposed for the maintainer to record; only the maintainer edits that page                                                                                                                                                                                                                                                                  |
| 15  | Listing the local version as a Claude Desktop extension (raised in the Oct 26 discussion)                                    | **Dropped**                                                                                                                          | Deprecated by Anthropic (§3). A Claude Code plugin is possible but is not in this round                                                                                                                                                                                                                                                     |

## 6. Design

### 6.1 Annotations and server metadata (M1)

Every tool gets a top-level `title` (protocol 2025-06-18 and later) and
`annotations` with `title` (2025-03-26 clients read only this), plus all four
hints as explicit booleans:

| Tool                          | title             | readOnly | destructive | idempotent | openWorld |
| ----------------------------- | ----------------- | -------- | ----------- | ---------- | --------- |
| `get_status`                  | Check connection  | true     | false       | true       | false     |
| `list_tasks`                  | List tasks        | true     | false       | true       | false     |
| `get_task`                    | Get task          | true     | false       | true       | false     |
| `list_projects`               | List projects     | true     | false       | true       | false     |
| `list_tags`                   | List tags         | true     | false       | true       | false     |
| `create_task` (local, hosted) | Add task to Inbox | false    | false       | false      | false     |

- **`destructiveHint: false` on `create_task` is a deliberate choice.** It adds
  and never overwrites. That matches the MCP definition ("only additive
  updates") and ChatGPT's rule. Claude's wording is "true for tools that modify
  or delete data", and creating a task changes no existing data. If Claude's
  review disagrees, flipping it is a one-line change on both servers.
- **`openWorldHint: false`.**
  - The tools act on the user's own task list, like a memory tool rather than a
    web search.
  - An issue integration the user configured to auto-create issues for Inbox
    tasks still acts on a captured task, as it would on one added by hand (wiki
    3.01 already says so).
  - Edit tools would be different, because two-way issue sync pushes edits to
    linked issues (§6.3).

`serverInfo` gains `title: "Super Productivity"` and `websiteUrl` (2025-11-25
`Implementation`). No icons: the directories take their icon from the
submission form.

### 6.2 Distribution (M2)

- **`.mcpb`.**
  - `tools/mcpb/pack.js` keeps `fflate`. It stamps the manifest `version` with
    the app version, adds the app icon (`build/icons/512x512.png` as
    `icon.png`), and prints the SHA-256 for registry use.
  - The `linux-bin-and-snap-release` job, which already runs `npm i`, packs it
    on tag builds and uploads it to the draft release with
    `gh release upload --clobber`.
- **In-app link.** Under "Connect an assistant": "Claude Desktop: install the
  extension".
  - It points to `releases/latest/download/super-productivity.mcpb`, which
    resolves to the newest published release; drafts and pre-releases are
    skipped.
  - It shows only for the Windows channels and `mac-dmg`
    (`window.ea.getDistChannel()`). Claude Desktop has no Linux build, and a
    Mac App Store build cannot listen yet.
- **MCP Registry.** One entry, `io.github.super-productivity/supersync`, for the
  hosted endpoint.
  - It declares the `Authorization: Bearer {token}` header as required and
    secret, because VS Code and Cursor read registry entries but are not on the
    OAuth allowlist.
  - The `.mcpb` gets no registry entry: registry consumers rarely install
    bundles, and each release would need a new immutable version.
  - A `workflow_dispatch` workflow publishes it with GitHub Actions OIDC. It
    uses `mcp-publisher` v1.8.1, pinned by SHA-256.
  - Docker's catalog, Smithery and Glama follow by hand.
- **Privacy policy.** Section 6 C of the SuperSync privacy template, plus
  pointers in sections 3, 4 and 8. All of it is rendered only when
  `CAPTURE_CONNECTOR_ENABLED` is on. A second fresh-context review checked
  every statement against the code (Oct 27), and the section now covers:
  - what the assistant sends, and what the server sees only in memory (the
    retry window keeps a keyed fingerprint, not the text)
  - what is stored with each waiting task, per connection, for codes and
    pending sign-ins, and the public key's switched-off marker
  - when each of these is deleted, rendered from `RETENTION_DAYS`
  - IP counts for rate limits, held in memory only. The daily cleanup now
    prunes expired counters, so the policy can bound them.
  - removal, sign-out and switch-off
  - that synced settings, which hold the private key, are accepted only end-to-end
    encrypted (the server's E2EE gate, #9457)
  - aggregate counting per kind of assistant
  - its legal bases

  **Pre-review (Oct 27).** Four fresh-context reviewers (legal bases,
  recipients, code accuracy, minimisation and clarity) checked the section. It
  now names each legitimate interest and maps every activity to its basis,
  gives the objection route, lists the assistant's provider as a recipient
  (§9) with its possible non-EU location, states the real bound of the
  in-memory counts (24 hours, then a day), names where to revoke, and uses
  plainer words. Two code mismatches were fixed ("last used" is not truncated;
  an approved sign-in expires after 1 minute) and the counting is described as
  a manual query, because no code produces it. Sections 3(2) and 6 A/B no
  longer call E2EE optional; 6 A discloses data uploaded unencrypted before
  #9457. Section 12 now names browser storage instead of session cookies; the
  login page no longer keeps the email in `localStorage` (TDDDG §25), only the
  sign-in token in `sessionStorage`. A second pass (research, Codex, review)
  added that a provider may echo rejected field names, the §9 recipient bullet
  and a mailto for objections. Transfers to a provider: EEA users contract
  with its EU entity (Anthropic Ireland, OpenAI Ireland), so that is a
  disclosure inside the EU. Elsewhere it is the US entity; neither Anthropic's
  privacy policy nor OpenAI's (per summaries; its page returned 403) claims
  the EU–US Data Privacy Framework, both name SCCs, so the policy states the
  facts and no Chapter V mechanism (Art. 13(1)(f)). Art. 49(1)(b) was dropped:
  the sends are not occasional.

  **Open for a lawyer:**
  - Chapter V basis for sending credentials to a provider's US entity (users
    outside the EEA). Accepted gap: credentials and confirmations only, sent
    at the user's request. If needed later: an explicit-consent line on the
    OAuth consent page (Art. 49(1)(a)).
  - The internal record of the legitimate-interest balancing tests.
  - The reviewers judged the provider an independent controller, the abuse
    limits fine under Art. 6(1)(f) and recital 49, and the in-memory counts
    fine without a further bound; confirm.

  **Legal review before deploy:** the hosted instance serves it on its next
  deploy.

### 6.3 Local planning tools (M3, deferred)

This waits for the demand signal in §1. When it returns, the review's findings
are requirements:

1. **Outside effects.** Edits reach outside services:
   - two-way issue sync pushes `isDone`, `title`, `notes`, `dueDay`,
     `dueWithTime`, `timeEstimate` and `tagIds` on `updateTask`,
     `scheduleTaskWithTime`, `planTaskForDay` and `unscheduleTask`
     (`issue-two-way-sync.effects.ts:70–78, 207–216`)
   - completing a Jira task runs transitions (`jira-issue.effects.ts`)
   - a timed schedule writes calendar time-blocks
   - a move into a Plainspace project creates a remote issue

   So either reject edits on issue-linked or time-blocked tasks, or declare
   `openWorldHint: true` behind a separate scope. Otherwise a steered assistant
   can copy private notes into a public issue.

2. **Same code as the menu.** Extract the context menu's schedule branching into
   a shared service and call it from both. Claim "the same ops as the UI path",
   not "one op": effects add ops (`onAllSubTasksDone$`,
   `planStartedTaskForToday$`, `autoAddTodayTagOnTracking`). Test with real
   effects, not a mocked store.
3. **No notes writes.** `get_task` cuts notes at 8 KB, so a read-modify-write
   loses the rest, and `notes: ""` is a delete in disguise.
4. **Async outcome discipline.** Load everything first. Re-check
   `isApplyingRemoteOps()` right before each dispatch, and treat a main-side
   timeout as `OUTCOME_UNKNOWN`. A `log_time` error tells the assistant to check
   `get_task` before retrying, because a retry double-counts time.
5. **Overdue filter.** Serve it from the internal route with
   `selectUndoneOverdue`, not REST: the REST handler is at 1193 of its
   1200-line cap. `get_status` returns the logical `today`, so "tomorrow" means
   the same as in the app.
6. **`start_tracking`.** Reject parents, done tasks, and starts while tracking
   is off, exactly where the play button is hidden
   (`task-hover-controls.component.html:1`).
7. **Project moves and estimates.** Reject a project move for a recurring task
   with more than one instance; a move skips the menu's confirm dialog. Reject
   `timeEstimate` on a parent, which subtasks recompute.
8. **Limits.** A local daily write cap, like the hosted 200 a day. No undo
   exists for edits, so say so.

### 6.4 Time summary (M4, deferred)

When it returns:

- It reuses the worklog mapping (`map-archive-to-worklog.ts`). Summing
  `timeSpentOnDay` double-counts, because a parent's value is the sum of its
  subtasks.
- It leaves out tasks of archived projects.
- It records the partial reversal of "archive never exposed" in wiki 3.01:
  totals only, no archived titles.

### 6.5 Remote planning through the user's device (M5, gated, not built now)

- **Shape.** The hosted `/mcp` keeps one URL. OAuth adds the scopes
  `tasks:read` and `tasks:edit` to `scopes_supported` and to the consent page.
  - For a tool other than `create_task`, the server picks an online device of
    that user that announced `assistantRelay` over the sync WebSocket
    (`sync/websocket.routes.ts`).
  - It sends `{type: 'assistant_request', id, tool, args, grantScopes}` and
    waits up to 20 s for `{id, result}` (at most 256 KB).
  - It returns the result and stores nothing.
- **Device.** Desktop only in v1. The renderer receives the message and passes
  it over IPC to main's existing `runTool`. The scopes applied are the
  intersection of the grant's scopes and this device's Assistant access scopes.
- **Offline.** `create_task` keeps the sealed queue. Other tools answer
  "Super Productivity is not running on a computer with assistant access on."
- **Privacy text.** "Your tasks stay on your devices. When your assistant asks,
  your own computer answers; the sync server passes the answer through without
  storing it. The assistant's provider sees what it reads."
- **Directory review** needs an always-on demo device, plus the M2b reviewer
  code.
- **Gate (all three):**
  1. Sustained hosted use, measured as grants used in the last 30 days (the
     maintainer sets the number).
  2. M3 back with the §6.3 requirements met.
  3. The capture connector holds a Claude Community listing.
- **Estimate:** 4–6 focused weeks, including E2E on SuperSync and a
  fresh-context review.
- **Rejected alternatives:**
  - The headless client (§5, row 9).
  - A zero-knowledge tunnel that terminates TLS on the device. It needs
    per-user hostnames and certificates, and the assistant's vendor sees the
    plaintext anyway.

### 6.6 Reviewer access (M2b) and submissions (M6, maintainer)

**Reviewer code.**

- The operator sets `CAPTURE_REVIEW_EMAIL` and `CAPTURE_REVIEW_CODE`: 20 to 32
  characters, both or neither.
- On the consent page that code approves an authorization for that one
  verified account, if it has capture switched on. The usual checks run: user
  lock and token version.
- Unlike a connect code it is reusable, so each reviewer session gets its own
  grant.
- **Limits:**
  - It is rate-limited like the connect code (10 approves per minute per IP).
  - It grants only capture: write-only, at most 200 tasks a day.
  - It reaches only the demo account.
  - Unsetting the variables ends it, and revoking in the demo account's app
    removes the grants.
- It is logged without the code.

**Submissions:**

- **Claude:** submit the hosted connector through the portal, after the
  redeploy and the privacy section's legal review.
  - Docs: wiki 3.01 § Agent Task Capture. Support: GitHub issues. Plus an icon.
  - Test credentials: the reviewer code, plus the demo account's connect steps.
  - Three example prompts: "Add 'renew passport' to my Super Productivity
    Inbox for next Monday", "Remind me every weekday at 9:00 to review my
    plan", and "Save these three action items from this email as tasks".
- **ChatGPT:** the same connector, after identity verification and the domain
  token.
  - 5 positive and 3 negative cases.
  - A demo video (`e2e/store-video` tooling).
  - A global-residency project.
- **The listing text says "adds tasks; it can't read them"** until M5.

### 6.7 Scenarios (the quality bar)

Run by hand per release, by the maintainer, for the tools that exist. Each
scenario passes only when it works with one prompt and no correction. Claude's
permission prompts do not count as corrections.

1. "Add 'call Anna' for tomorrow at 15:00." (`create_task`)
2. "Remind me every weekday at 9:00 to review my plan." (`create_task repeat`)
3. "Save these three action items from this email as tasks." (three
   `create_task` calls)
4. Local: "What's on my plate today, and is it realistic for 6 hours?"
   (`list_tasks tagId:TODAY` + estimates)
5. Local, with only capture granted: "What's on my list?" The read tools are
   not listed, and the assistant says it lacks permission.
6. Negative: "Delete all my tasks." There is no tool for it.

The M3 and M4 scenarios (overdue moves, completing, logging time, weekly
summary) return with those milestones.

## 7. Milestones

| #   | Deliverable                                                                                                                     | Verify                                                                                                                                                                                                                                | Estimate  | Status        |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------- |
| M1  | Annotations and titles on all local and hosted tools; `serverInfo.title` and `websiteUrl`                                       | `npm run test:electron` asserts a title and four boolean hints on every tool; server specs check the hosted tool and `serverInfo`                                                                                                     | 0.5 day   | Done (branch) |
| M2  | Privacy section; `.mcpb` with icon and version, uploaded on tag builds; in-app link; hosted registry entry and publish workflow | `legal-pages.spec.ts` with the connector on and off; the packed file passes `unzip -t` and the MCPB CLI's `validate` (run from a temp directory); `server.json` validates against its schema; component spec for the link's platforms | 1–2 days  | Done (branch) |
| M2b | Reviewer code                                                                                                                   | pglite specs: approve with the code binds only the demo account, is reusable, refuses a wrong code or a demo account with capture off, and is ignored when unset; config rejects partial or short values                              | 1 day     | Done (branch) |
| M3  | Local planning tools                                                                                                            | §6.3                                                                                                                                                                                                                                  | 2–3 weeks | Deferred      |
| M4  | Time summary                                                                                                                    | §6.4                                                                                                                                                                                                                                  | 1 week    | Deferred      |
| M5  | Relay                                                                                                                           | §6.5                                                                                                                                                                                                                                  | 4–6 weeks | Gated         |
| M6  | Submissions                                                                                                                     | Maintainer                                                                                                                                                                                                                            | days      | Next          |

## 8. Long-term cost

- **Sync.** None: no synced field, action, op or schema change.
- **Public contracts.**
  - Tool titles and annotations become part of the tool listing.
  - The registry name `io.github.super-productivity/supersync` and its
    published versions are permanent.
  - The `.mcpb` asset name `super-productivity.mcpb` is linked from the app and
    must stay.
- **Hosted auth surface.** The reviewer code adds a second way to approve an
  authorization. It is limited to one operator-named account, off unless both
  variables are set, and covered by the existing rate limits.
- **Recurring work.**
  - The §6.7 scenarios, by hand per release.
  - The demo account, and its device for M5.
  - Re-checking directory rules yearly; both changed in 2026.
  - Bumping the pinned `mcp-publisher`.
  - Legal review when the privacy section changes.

## 9. Decisions for the maintainer

1. Legal review of the privacy section, then redeploy the hosted server.
   Confirm its tool list shows `dueDate`, `dueTime` and `repeat`.
2. Create the demo account, set `CAPTURE_REVIEW_EMAIL` and
   `CAPTURE_REVIEW_CODE` on the hosted server, and submit to Claude's
   directory. Unset both once the review is done. The server warns if they
   are set while `CAPTURE_CONNECTOR_ENABLED` is off.
3. Run the registry workflow once the hosted server is redeployed.
4. ChatGPT: verify as an individual or a business, create a project with global
   data residency, and add the domain token.
5. Record "external assistants through MCP, no built-in assistant" on the
   market page.
6. Set the M5 gate (number of grants used in 30 days, review date) and the M3
   demand bar.
7. Ship the MAS entitlement release (09-22, §3) if macOS App Store users should
   get the local endpoint.
8. Release note for self-hosters: the privacy template changed outside the
   capture section too (E2EE is no longer called optional; 6 A and §12
   reworded); re-read a customised copy.

## 10. Out of scope

- Delete, archive and bulk tools.
- Subtask creation, and project or tag creation.
- Calendar events.
- A built-in assistant.
- Telemetry.
- Server-created ops.
- A headless server client.
- A Claude Code plugin.
- A `.mcpb` registry entry.
- The 2026-07-28 protocol revision (unchanged from 09-22).

## Review

A fresh-context adversarial review of rev. 1 (Oct 26) checked it against the
code, the earlier plans and the review guide. Fixed in rev. 2:

- **B1 — edits reach outside services, so `openWorldHint: false` would be wrong
  for them.** It became M3 requirement 1. §6.1 keeps `false` for the shipped
  tools and says why.
- **B2 — M3 and M4 do not earn their place yet.** Both are deferred, and §1
  names a local demand signal.
- **B3 — "follows the context menu" and "one op" were false.** These became
  requirement 2.
- **B4 — notes writes lose data past 8 KB.** Requirement 3: no notes writes.
- **S1 — async outcome discipline.** Requirement 4.
- **S2 — M4 would partly reverse the archive promise and double-count.** §6.4.
- **S3 — the zip writer was an unlisted reversal.** `fflate` is kept, in the job
  that already installs dependencies.
- **S4 — REST cap and logical today.** Requirement 5.
- **S5 — `destructiveHint` against Claude's wording.** Recorded as a deliberate
  choice in §6.1.
- **S6 — `start_tracking` behavior.** Requirement 6.
- **S7 — reviewers cannot sign in; registry clients cannot use OAuth.** M2b adds
  the reviewer code, and the registry entry declares the bearer header.
- **S8 — the uptake signal is a new purpose.** The privacy section discloses
  aggregate counting, and the gate uses `lastUsedAt`.
- **S9 — §8 overstated the limits on damage.** It now covers only what ships;
  requirement 8 holds the rest.
- **Nits, all fixed:**
  - parent estimates
  - the `.mcpb` link on MAS and Linux
  - the `.mcpb` registry entry (dropped)
  - `id-token: write`
  - estimates
  - the ClickUp claim
  - the hard-coded 45 days (now rendered from `RETENTION_DAYS`)

Not fixed:

- **"Rejecting tags on subtasks differs from the menu."** This is moot while M3
  is deferred.

## Sources

- Repository: `electron/mcp/*`, `electron/shared-with-frontend/{assistant-access.model,get-dist-channel}.ts`,
  `src/app/features/tasks/assistant-capture/*`,
  `src/app/core/electron/local-rest-api-handler.service.ts`,
  `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts`,
  `src/app/features/issue/two-way-sync/issue-two-way-sync.effects.ts`,
  `src/app/features/tasks/store/{task.reducer,task-internal.effects}.ts`,
  `packages/super-sync-server/src/capture/*`, `packages/super-sync-server/src/server.ts`,
  `packages/super-sync-server/templates/privacy.template.html`,
  `tools/mcpb/*`, `.github/workflows/build.yml`, `docs/market/{README,scorecard}.md`.
- [Claude connector submission](https://claude.com/docs/connectors/building/submission.md),
  [review criteria](https://claude.com/docs/connectors/building/review-criteria.md),
  [authentication](https://claude.com/docs/connectors/building/authentication.md),
  [MCPB](https://claude.com/docs/connectors/building/mcpb.md),
  [Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy),
  [Todoist listing](https://claude.com/marketplace/connectors/todoist).
- [ChatGPT app/plugin submission](https://help.openai.com/en/articles/20001040-submitting-apps-to-the-chatgpt-app-directory),
  [app review](https://developers.openai.com/plugins/deploy/app-review),
  [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines) (snippet).
- [MCP Registry](https://github.com/modelcontextprotocol/registry) docs
  (`authentication.mdx`, `remote-servers.mdx`, `package-types.mdx`,
  `github-actions.mdx`) and the
  [2025-12-11 server.json schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json).
- [MCP tool annotations](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
  (spec source on GitHub).
- [Parallel Code](https://github.com/johannesjo/parallel-code) README.
