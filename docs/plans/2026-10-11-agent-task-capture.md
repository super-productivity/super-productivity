# Agent task capture

Oct 11, 2026 · status: M1+M2 shipped in #10759 (scheduling: #10829, #10899); M3–M4 open · rev. 3; rev. 2 after an adversarial
review and a Codex review

Let any AI agent add a task to Super Productivity: Claude (web, desktop,
mobile, Claude Code local and cloud), ChatGPT, other MCP clients and plain
HTTP scripts. One hosted, write-only MCP endpoint on SuperSync with one tool,
`create_task(title, notes?)`. The server seals each capture to a key only the
user's devices hold; the app turns it into one Inbox task after its next sync.

Builds on, and replaces the open questions of:

- the hosted capture connector plan (`docs/plans/2026-10-11-hosted-capture-connector.md`
  on `origin/ccr-69703d49-zx2eku`);
- the set-aside Stage A capture queue (`feat/task-1-7236d7`), whose tests show
  which failure modes are real;
- PR #10251, the local desktop MCP endpoint.

## Decision

**One path: the hosted endpoint.** It reaches every agent, including local
ones: Claude Code, Codex or Cursor on a laptop call the same URL with a
capture token. Agents running in vendor clouds (claude.ai web and mobile,
ChatGPT, Claude Code cloud sessions) can only reach a public endpoint; Claude
calls from `160.79.104.0/21`, never from the user's machine.

PR #10251 is not part of this plan. It adds what the hosted path can't:
local read access, offline use, and users without SuperSync. Decide it on
those merits; capture does not need it.

The headless client from the 09-22 handover stays deferred. It is the path to
remote read access, and costs reducer extraction (about 240 files) plus a
server holding the user's key and full plaintext state.

## Changes from the Oct 11 hosted plan

| Area                      | Oct 11 plan                                                                         | This plan                                                                  | Why                                                                                                                                                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paths                     | Hosted only, #10251 in parallel                                                     | Hosted only; #10251 decided separately                                     | The hosted path alone reaches every client                                                                                                                                                                                                                                                    |
| First auth                | OAuth                                                                               | **Capture tokens first**, OAuth second                                     | Claude Code, Codex, Cursor and Gemini CLI accept a static `Authorization` header; Claude Code cloud reads repo `.mcp.json` with `${VAR}` headers                                                                                                                                              |
| Private key               | Wrapped with the E2EE password, stored on the server, re-wrapped on password change | **One optional synced config field**                                       | Every password-changing path (change, clean slate, account reset) already re-encrypts synced state. A server-side wrap needs its own cross-device commit protocol: the change flow saves the new password before its upload and keeps it on failure (`encryption-password-change.service.ts`) |
| Feature state             | Server key row; app asks the server                                                 | Presence of the synced key                                                 | Devices learn "on" and "off" through sync; users who never enable it send no extra requests                                                                                                                                                                                                   |
| OAuth sign-in             | Reuse passkey or magic-link sign-in                                                 | **Connect code** shown in the app                                          | The server has no login-then-continue page; a magic link opens a new tab and loses PKCE and state                                                                                                                                                                                             |
| OAuth clients             | Fetch any CIMD URL                                                                  | **Allowlist** of known clients in server config, no fetch                  | Generic CIMD fetching is an SSRF surface; the clients that matter are few and known                                                                                                                                                                                                           |
| Assistant retries         | Not handled                                                                         | Best-effort **retry window**                                               | Stage A retry probe: 0 of 7 hint-free calls sent an idempotency id                                                                                                                                                                                                                            |
| Lease and redelivery      | 24 h lease; same task id for every device                                           | Own leases always returned; **new task id when another device takes over** | Hiding a device's own leased items prunes its receipts (`native-capture-importer.service.ts:119`), and two same-id creates from two clients diverge permanently (Stage A)                                                                                                                     |
| Restore                   | Not covered                                                                         | Runbook: empty all capture tables after a full restore                     | Restored rows would recreate deleted tasks and revive revoked grants                                                                                                                                                                                                                          |
| "Captures waiting" signal | `/status` field + WebSocket message                                                 | Claim after each sync                                                      | The app never calls `/status` (`sync.routes.ts:223`); YAGNI until latency matters                                                                                                                                                                                                             |

Unchanged: write-only, server never writes ops, sealed at rest with ECDH
P-256 + HKDF + AES-GCM, one ordinary local `addTask` per capture,
`CAPTURE_CONNECTOR_ENABLED` off by default, no new dependencies, no schema
bump.

## Tool contract

`create_task(title, notes?)`: `title` 1–500 characters after trimming,
`notes` up to 8 KiB UTF-8, `additionalProperties: false`. The Inbox unless
`project` names one (added Oct 29, below);
`#tag`, `+project` and dates stay literal (`isIgnoreShortSyntax: true`).
Annotations `readOnlyHint: false`, `destructiveHint: false`.

Result: "Saved. It will appear in your Super Productivity Inbox the next time
the app syncs." It never claims the task exists.

Public once shipped: adding optional fields is compatible, removing or
renaming is not. If #10251 lands, it uses the same limits.

Added Oct 15 2026: optional `dueDate` (`YYYY-MM-DD`) and `dueTime` (`HH:MM`,
needs `dueDate`). They travel as optional fields of the v1 payload, so
released apps ignore them and add the task unscheduled. The importing device
resolves them in its own time zone into `dueDay`, or `dueWithTime` plus the
default reminder, inside the one `addTask`; an invalid value is dropped, not
the task. The retry window keys on them too.

Also added: optional `repeat: { cycle, every?, weekdays? }` (cycle
`daily | weekly | monthly | yearly`, `every` 1–99, `weekdays` weekly only).
The importing device makes the new task repeatable with the add-task bar's
own `addTaskRepeatCfgToTask` right after the `addTask` (no new action), so
the existing effects pick the first occurrence. An invalid `repeat` is
dropped, leaving a one-off task. The tool stays write-only: its only answer
is "Saved", so no task or setting data reaches the assistant.

The local `create_task` of #10251 takes the same optional fields with the
same validation (#10833); invalid input is rejected, not dropped, and a timed
one-off is likewise scheduled in its one `addTask`.

Added Oct 29 2026: optional `project`, the title of an existing project (1–200
characters after trimming). It travels as an optional v1 field like the
schedule, so released apps ignore it and use the Inbox. The importing device
reads its projects when it creates the task, not when it claims, and files
the task (and its repeat config) into the one whose title matches ignoring
case and surrounding space, still in the one `addTask`. Only unarchived,
visible projects that no enabled issue provider is bound to count: the
`addTask` would otherwise auto-create an issue (implicitly for Plainspace) and
post text an assistant may have been steered into writing to a shared or
public tracker. No match or
several matches keep the Inbox; a project is never created. The server can't
check the title against sealed state, so the answer stays "Saved" either way
and names the Inbox fallback; no project data reaches the assistant. The
retry window keys on `project` too. The local `create_task` does not take it
yet.

## Flow

1. Settings → SuperSync → **"Let AI assistants add tasks"** (off by default).
   The device generates an ECDH P-256 key pair, stores it in the synced config
   (one op) and registers the public key with the server.
2. Connect an assistant:
   - **Token:** "Create token" shows `sp_cap_…` once (expires after 1 year),
     with a ready-to-copy Claude Code command (`claude mcp add --transport
http super-productivity <url> --header "Authorization: Bearer <token>"`,
     token filled in; the wiki covers repo `.mcp.json` with
     `${SP_CAPTURE_TOKEN}` for cloud sessions, and curl).
   - **OAuth:** add `https://sync.super-productivity.com/mcp` as a custom
     connector in claude.ai or ChatGPT. The authorize page names the client and
     its redirect host, states the permission ("Add tasks to your Inbox. It
     can't read your tasks.") and asks for the connect code shown in the app.
3. The assistant calls `create_task`; the server seals and queues it.
4. After its next successful sync, any SuperSync device with the key claims,
   opens and creates one Inbox task per capture, then acknowledges.
5. Settings lists assistants and tokens (name, created, last used, expiry).
   Revoke asks whether to discard that grant's pending items (count shown).
   Switching the feature off revokes everything and deletes pending items after
   a confirm that shows the count.

## Server

New folder `packages/super-sync-server/src/capture/`; nothing added to the
large existing services. All tables `userId` + `onDelete: Cascade`.

| Table                   | Columns                                                                                                                                                         | Note                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `capture_keys`          | `userId` PK, `publicKey`, `fingerprint`, `disabledAt?`                                                                                                          | `disabledAt` stops a stale device re-registering a key the user switched off |
| `capture_grants`        | `id`, `userId`, `kind` (`token`/`oauth`), `clientName`, `secretHash`, `refreshHash?`, `prevRefreshHash?`, `rotatedAt?`, `expiresAt`, `lastUsedAt`, `revokedAt?` | Tokens and OAuth share one revoke path                                       |
| `capture_items`         | `id`, `userId`, `grantId`, `ciphertext`, `createdAt`, `leaseDeviceId?`, `leaseUntil?`, `taskId`                                                                 | The queue                                                                    |
| `capture_auth`          | `id`, `userId?`, `clientId`, `redirectUri`, `codeChallenge`, `resource`, `state`, `codeHash?`, `tokenVersion?`, `expiresAt`                                     | Pending authorization, then its single-use code (60 s)                       |
| `capture_connect_codes` | `userId` PK, `codeHash`, `tokenVersion`, `expiresAt`                                                                                                            | One active code per user, 10 minutes                                         |

### Credentials

- Opaque tokens carry their grant id: `sp_cap_<grantId>_<secret>`, refresh
  `sp_rt_<grantId>_<secret>`. Only SHA-256 hashes are stored.
- `/mcp` looks tokens up only in `capture_grants`, and the sync
  `authenticate` preHandler is registered only on sync routes
  (`sync.routes.ts:72`); a sync JWT fails on `/mcp`, a capture token fails
  `jwt.verify` on sync routes.
- Capture tokens expire after 1 year. OAuth access tokens last 1 h; refresh
  tokens rotate, expire after 90 days unused, and the previous refresh token
  stays valid for 2 minutes (lost response, concurrent refresh). Any older
  refresh token revokes the grant.
- `revokeAllTokens`, `replaceToken` and feature-off, in one transaction:
  revoke grants, delete connect codes and pending authorizations. Codes and
  authorizations store the user's `tokenVersion` at mint and are rejected if
  it changed.

### `/mcp`

- `POST`: Streamable HTTP, stateless, JSON responses, protocol 2025-11-25.
  `initialize`, `notifications/initialized`, `ping`, `tools/list`,
  `tools/call`. `GET` and `DELETE` return 405.
- No or bad token: 401 with
  `WWW-Authenticate: Bearer resource_metadata="…", scope="tasks:capture"`.
- No key, or a disabled key: tool error "AI capture is switched off in
  Super Productivity."
- The handler is about 200 lines, written in the server and based on #10251's
  `mcp-protocol.ts` (which has no imports). No shared package until a second
  user exists.

**Limits.** 64 KiB body (8 KiB of notes can more than double when
JSON-escaped); 30 calls/min per grant, enforced after auth; 120 failed auths
per minute per IP (an IPv6 /64 is one IP), checked before the token lookup,
except for a grant id that authenticated in the last 24 h, whose failures
count per grant instead, so others' bad tokens behind a shared egress IP
cannot lock out a working connector; 200 new tasks per grant per day
(in-process, like the other counters), so a leaked token or an assistant
steered by a web page cannot flood the Inbox;
pending items 200 per grant and 500 per user ("Your capture queue is full.
Open the app to sync."). `/mcp`, `/oauth/*` and `/.well-known/*` use these
limits instead of the global per-IP limiter (`server.ts:417`), because vendor
traffic shares egress IPs.

**Retry window.** Per grant, `/mcp` runs one call at a time (in-process lock)
and checks a map of `HMAC(processKey, title + notes)` → item, 10 minutes.
A hit returns the same "Saved" without a new item; the entry is recorded only
after the insert commits. `// shortcut: in-process lock and map, single
SuperSync instance (helm max 1). Restarts drop it; move to a table if the
server scales out.` A deliberate identical repeat within 10 minutes is merged.

### App endpoints (behind the sync `authenticate`)

| Route                                                                 | Use                                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /api/capture/key`                                                | Register `{ publicKey }`. Same fingerprint: no-op. Different: replace and delete items sealed to the old key (count returned). Same fingerprint as a disabled key: 409.                                                   |
| `DELETE /api/capture/key`                                             | Feature off: set `disabledAt`, delete items, revoke grants, codes, authorizations                                                                                                                                         |
| `POST /api/capture/claim`                                             | `{ deviceId, fingerprint }`. Key missing: `no_key`. Fingerprint differs: `key_mismatch`. Otherwise up to 50 items: all items leased to this `deviceId` plus unleased or expired ones; lease 24 h, renewed on every return |
| `POST /api/capture/ack`                                               | `[{ itemId, taskId }]`; deletes only rows leased to this `deviceId` with that `taskId`                                                                                                                                    |
| `POST /api/capture/connect-code`                                      | Mint the code (replaces the previous one)                                                                                                                                                                                 |
| `POST /api/capture/tokens`                                            | Create a capture token                                                                                                                                                                                                    |
| `GET /api/capture/grants`, `DELETE /api/capture/grants/:id?discard=1` | List and revoke                                                                                                                                                                                                           |
| `POST /api/capture/items`                                             | Store `{ id, fingerprint, ciphertext }` a device sealed itself (Android share, [plan](2026-10-24-android-share-capture.md)). Idempotent by `id`; 409 `switched_off`, `key_mismatch`, `queue_full`, `id_conflict`          |

**`taskId` rule.** An item gets `taskId = itemId` on first lease; a
device-sealed item (`POST /items`) gets a server-issued `taskId` at insert
instead, since its id is the device's own. A
different `deviceId` taking over an expired lease gets a fresh `taskId`. A
device always gets back the `taskId` it was given. So two devices never create
the same task id, and acks from an old lease can't delete a newer one.

`deviceId` is a random id stored on the device for capture only, not the
op-log client id, so it survives the new client id a password change creates.

### OAuth (milestone 3)

- `/.well-known/oauth-protected-resource/mcp`: `resource` exactly
  `${PUBLIC_URL}/mcp`, one authorization server.
- `/.well-known/oauth-authorization-server`: PKCE `S256`, token auth `none`,
  `client_id_metadata_document_supported: true`, grants `authorization_code`
  and `refresh_token`, `scopes_supported: ["tasks:capture", "offline_access"]`
  (Claude requests refresh tokens only when `offline_access` is listed).
- **Clients from an allowlist** (`CAPTURE_OAUTH_CLIENTS`): `client_id` URL →
  display name and allowed redirect URIs, seeded from M0 (claude.ai callback
  `https://claude.ai/api/mcp/auth_callback`; Claude Code loopback
  `http://localhost` / `http://127.0.0.1`, any port). The server never fetches
  a URL. An unknown client gets a clear error page.
- `GET /oauth/authorize`: validates client, redirect, PKCE, `resource`;
  creates a `capture_auth` row; serves a static page with external JS (CSP
  `script-src 'self'`). Loopback redirects show a "running on this computer"
  note.
- `POST /oauth/authorize/approve` (JSON `{ authId, code }`): checks the
  connect code, binds the user, issues the authorization code, returns the
  redirect URL with `code`, `state` and `iss`; the page follows it with
  `location.href`, so CSP `form-action 'self'` stays.
- `POST /oauth/token`: form-encoded, needs a small
  `application/x-www-form-urlencoded` parser (none exists today).
  `invalid_grant` for dead codes and tokens.
- **Connect code:** 10 characters Crockford base32 (50 bits), single use,
  10 minutes. Approve is limited to 10 tries per minute per IP; new
  authorizations to 20 per hour per IP. No global approval quota, because
  unauthenticated guesses could exhaust it and block other users. Guessing is
  infeasible at these rates. **Phishing remains:** an attacker can start their
  own authorization and ask the user for the code. The app shows: "Only enter
  this code on a page you opened from your assistant." Damage is limited to
  adding tasks, and is revocable.

### Encryption at rest

- Key pair: ECDH P-256 in WebCrypto. The synced config holds
  `sync.captureKey?: { v: 1, privateKeyPkcs8, publicKeySpki }`; it is optional
  and absent means off (persisted-field rules, `frozen-state.spec.ts`).
- Seal (server, Node `crypto`): ephemeral P-256 key; ECDH with the user key;
  HKDF-SHA-256 with empty salt and info `"sp-capture-v1" ‖ ephemeral key ‖
user key`; AES-256-GCM, 12-byte random IV, 16-byte tag, AAD = version byte
  ‖ item id. Wire: base64 `[0x01][ephemeral key, SEC1 uncompressed, 65][iv
12][ciphertext ‖ tag]`. Payload `{ v: 1, title, notes, createdAt, client }`.
- Open (app): in `packages/sync-core`, WebCrypto.
- What it doesn't cover: the server process and the assistant vendor see the
  text while the request is handled, and an operator could insert captures.
  Consent page, settings and docs say so. A stolen sync login (JWT) can
  register its own key and read captures queued after that, or mint a capture
  token and insert tasks; the real device re-registers its key on its next
  claim, so the two keys alternate unnoticed. Accepted for M2; a replacement
  key signed by the current one, or a notice on key replace, would close it.
- Versions are a contract with released clients: they skip a key `v`, seal
  byte or payload `v` they do not know, and the item stays leased to them
  until it expires. The hosted server must keep emitting version 1 while
  released clients read only that.
- The private key travels inside E2EE-encrypted sync data and sits in local
  storage like the sync password does today. It appears in JSON exports and,
  after a switch to another provider, in that provider's files. It only opens
  captures held on the SuperSync server. SuperSync still allows sync without
  E2EE; then the server can read the key and the "stored encrypted" promise
  is void. The privacy text says so; gating the switch on E2EE is the
  stricter option if that proves too weak.

## App

- **Provider methods** in `packages/sync-providers/src/super-sync/super-sync.ts`
  next to `getDevices()`, with response validators.
- **`SuperSyncCaptureSource implements NativeCaptureSource`**, run through the
  existing `NativeCaptureImporter` (hydration and sync-window waits, dedupe by
  id, receipts, flush before ack). No importer change is needed, because own
  leased items stay in `getPending()` until acked, so their receipts survive.
  - `getPending`: claim, open. `capture.id` is the `taskId`; the source keeps
    a `taskId → itemId` map for `acknowledge`. On `no_key` it registers its
    synced key and claims again; on `key_mismatch` it replaces the server key
    with its synced key. An item that fails to open stays un-acked and is
    logged by id and error code only.
  - `createTask`: one `TaskSharedActions.addTask` with `id = taskId`, Inbox,
    `isIgnoreShortSyntax: true`, and `timeTracking.defaultEstimate` as its
    `timeEstimate`, so `setDefaultEstimateIfNonGiven$` adds no second op.
  - **Epoch fence:** the source captures `(provider, syncEpoch)` from
    `SyncProviderManager` in one synchronous block when it claims, and throws
    in `createTask` and `acknowledge` if either changed. An account switch,
    provider change or password change mid-import then creates nothing and acks
    nothing (contributor sync model, sync-epoch fence).
- **Import:** the app turns markdown images in captured notes into links
  and shows media tags as text, so opening a task loads nothing from whoever
  steered the assistant (a remote image is a read receipt and IP beacon).
- **Trigger:** a small service on the falling edge of the sync-in-progress
  signal, only when that sync ended `IN_SYNC`: after a failed
  sync the synced key may be stale, and its claim would replace a newer
  server key and drop that key's captures. It runs only if the provider is
  SuperSync and `sync.captureKey` exists, at most once per minute, one run
  at a time (a Web Lock across tabs, which share the device id), detached.
  A server without capture routes (404) is logged once per session, not as
  an error each sync. No change to
  `sync-wrapper.service.ts` (2080 of 2084 allowed lines). SuperSync has no
  interval polling (`sync-trigger.service.ts:266`), so captures arrive when
  the app next syncs: opening or using it, or another device's change.
- **Switch on:** generate the key, `PUT /api/capture/key`, then write
  `sync.captureKey` (one op). A server without capture refuses the PUT and
  nothing is saved.
- **Switch off:** `DELETE /api/capture/key` first, so a failed request changes
  nothing and can be retried, then clear `sync.captureKey` (one op). A stale
  device that still has the key gets 409 on re-register and stops; the synced
  op reaches it on its next sync.
- **Settings:** a custom block in the SuperSync section of
  `sync-form.const.ts`: switch, URL with copy, "Create token", connect code,
  assistants list with Revoke, and the privacy note. Strings in `en.json` only.

## Failure modes

| Case                                                                                               | Outcome                                                                                                                                                               | Mechanism                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assistant retries after a timeout                                                                  | One task, best effort (restart drops the window)                                                                                                                      | Retry window                                                                                                                                                    |
| Two devices claim at once                                                                          | One task                                                                                                                                                              | Row lock, `FOR UPDATE SKIP LOCKED`                                                                                                                              |
| App killed after claim, or claim response lost                                                     | Same device picks it up on its next run                                                                                                                               | Own leases always returned                                                                                                                                      |
| Ack lost, user deletes the task, same device                                                       | Not recreated                                                                                                                                                         | Item stays in `getPending()`, receipt survives                                                                                                                  |
| Device creates a task, then goes offline more than 24 h without acking; another device takes over  | Possibly a duplicate, or a deleted task reappears, once the first device returns. Never same-id divergence                                                            | New `taskId` on takeover. **Accepted** (see decisions)                                                                                                          |
| Same takeover, for a recurring capture                                                             | Possibly two repeat series that both keep creating tasks, until the user deletes one                                                                                  | New `taskId` and repeat config id on takeover. **Accepted** with the row above                                                                                  |
| `addTask` persists, `addTaskRepeatCfgToTask` fails                                                 | The task stays a one-off; the retry skips it because the task exists                                                                                                  | Persist failure stops the run. **Accepted**: rare; a fix needs the shared importer to re-run follow-ups                                                         |
| Local `create_task`: `addTask` persists, `addTaskRepeatCfgToTask` fails                            | `OUTCOME_UNKNOWN` with the task id; the task may be a one-off; a retry creates a duplicate                                                                            | Sticky persist-failure flag after the flush. **Accepted**: rare; the tool tells the assistant to check the Inbox first                                          |
| Timed one-off capture with calendar auto time-blocking on                                          | No time-block event, no plugin `taskUpdate`; reminder and Today work                                                                                                  | Added in one `addTask`, no `scheduleTaskWithTime` (avoids a second op and a snack per import). **Accepted** (Oct 15 2026); timed recurring captures do get both |
| Account switch or password change mid-import                                                       | Nothing created or acked; retried later                                                                                                                               | Epoch fence; `deviceId` survives the new client id                                                                                                              |
| Concurrent `SYNC_IMPORT` elsewhere drops the `addTask`                                             | Task lost, like any local edit                                                                                                                                        | By design (sync rule 7)                                                                                                                                         |
| Two devices enable at once                                                                         | Synced key converges by LWW; the first claim fixes the server key; items sealed to the losing key dropped                                                             | `key_mismatch` → replace                                                                                                                                        |
| Backup import restores a config without the key                                                    | Feature reads off on all devices                                                                                                                                      | Synced state                                                                                                                                                    |
| Full database restore                                                                              | Pending items, grants and codes from the snapshot dropped; devices re-register their key; assistants reconnect                                                        | Runbook                                                                                                                                                         |
| Leaked capture token                                                                               | At most 200 junk items per day; revoke can discard them                                                                                                               | Per-grant cap, revoke with discard                                                                                                                              |
| No device syncs within `RETENTION_DAYS` (45)                                                       | Items expire                                                                                                                                                          | Documented                                                                                                                                                      |
| An item this device cannot open or validate                                                        | Stays leased to this device, renewed on each claim, until it expires; 50 such items fill its batch                                                                    | **Gap**: needs a lease-release endpoint                                                                                                                         |
| Turn off while the server has no capture (flag off, rollback, other server); capture returns later | Key cleared locally, but server tokens were never revoked and work again: captures go to a key no device holds and expire, or reach the Inbox after a later switch-on | 404 counts as off. **Accepted**: needs an operator flip; revoke server-side then                                                                                |

## Milestones

Each step has its check; the next starts only after it passes.

| #   | Deliverable                                                                                                                                                                                                                                            | Verify                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | **Spike** on public https staging, synthetic content only: `/mcp` with `create_task` writing to a log; a stub authorization server (PRM, metadata with `offline_access`, an authorize page with a fixed code, token with refresh); a bearer token path | Matrix: claude.ai web; Claude mobile (does a connector added on web appear there?); Claude Code local with OAuth and with a bearer token; a Claude Code cloud session; ChatGPT (which plan allows write tools, mobile, how it identifies itself: CIMD, static client or DCR). Refresh happens after 1 h. Record client ids and redirect URIs for the allowlist.                                                                                                                                                                                                 |
| M1  | **Server:** tables and migration, credentials, `/mcp`, seal, retry window, key/claim/ack with the `taskId` rule, limits, cleanup step (items after `RETENTION_DAYS`, expired codes, authorizations and grants), flag, backup runbook                   | Vitest + pglite, plus concurrent real Postgres connections for claim. Sync JWT refused on `/mcp`; capture token refused on `/api/sync/*`; caps; retry window under concurrent identical calls; own leases returned; takeover issues a new `taskId`; an A → B → A stale ack deletes nothing; disabled key refuses re-register; account deletion cascades; `revokeAllTokens` kills grants and codes. Seal vectors: open with Node, tamper, truncation, wrong key.                                                                                                 |
| M2  | **App:** synced `captureKey` field, open side, provider methods, source with epoch fence, trigger service, settings, privacy text; wiki section for token setup                                                                                        | Unit specs for crypto (the same vectors as M1), source and trigger; package tests for `sync-core` and `sync-providers`; `npm run test:affected`; `frozen-state.spec.ts`. E2E (`e2e:supersync`, `--retries=0`): token call → sync → one Inbox task; kill after claim → one task; lost ack + delete → not recreated; second device takes over after a shortened lease → distinct ids, both clients converge; account switch mid-import → nothing created; switch off with a stale second device → stays off. **First release:** token clients, with privacy docs. |
| M3  | **OAuth:** metadata, allowlist, authorize page with connect code, token, refresh rotation with grace, revocation boundary                                                                                                                              | Specs: PKCE, `resource` mismatch, unknown client, unlisted redirect, loopback any port, code reuse, attempt limits, refresh reuse revokes, grace window, revoke during an in-flight exchange. Live: every client in the M0 matrix connects and adds a task.                                                                                                                                                                                                                                                                                                     |
| M4  | **Release:** wiki page per client, privacy-policy addition, release notes, enable on the hosted server                                                                                                                                                 | Docs name only clients verified in M0 or M3; the native-capture plan's "hosted capture stays deferred" line points here                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Long-term cost

- Sync: one new optional synced field (`sync.captureKey`); no new action, no
  meta-reducer, no `CURRENT_SCHEMA_VERSION` change. One capture = one local
  `addTask`. Remote ops never trigger the importer.
- Wire: new HTTP routes only; older apps never call them.
- Public contract: the `create_task` input and result text.
- Maintenance: the OAuth surface and the client allowlist. Re-check the MCP
  auth revision and vendor redirect rules yearly; both changed in 2026. The
  token path does not depend on either.
- The app PR touches sync triggering and a synced field: give it the
  fresh-context review pass before ready.

## Decisions (maintainer, Oct 11 2026)

1. **Hosted path only for capture.** #10251 is decided separately, on local
   read access, offline use and users without SuperSync.
2. **Server-side MCP in SuperSync, capture only.** Reverses the 09-16 plan's
   non-goal and the 09-22 handover's choice. The server sees capture text in
   memory and could insert tasks; it never stores plaintext. A hosted headless
   client would hold the key and full state instead.
3. **Capture key as a synced config field**, not a password-wrapped key on
   the server. Cost: a secret in synced state and in exports. Gain: no re-wrap
   protocol and no key-reset UI.
4. **Capture tokens in v1, 1-year expiry**, matching the sync JWT. Write-only,
   revocable, at most 200 pending items each.
5. **Connect code and a client allowlist** instead of server sign-in and
   generic CIMD fetching.
6. **Accept the rare duplicate** when a device creates a task and then stays
   offline for more than 24 h without acking. Lease stays 24 h.
7. **10-minute best-effort retry window** that also merges identical repeats.
8. **Self-hosted default off**, hosted on.

## Out of scope

Reading tasks remotely, editing, tags, project creation, DCR, generic CIMD
fetching, WebSocket push for captures, server-created ops, non-SuperSync
providers.

## Sources

- Oct 11 hosted plan: `git show origin/ccr-69703d49-zx2eku:docs/plans/2026-10-11-hosted-capture-connector.md`
- Stage A: `feat/task-1-7236d7`, `docs/plans/2026-09-17-agent-capture-stage-a.md`
  (create-then-ack rejection at 200–222, same-id divergence, restore hold,
  retry probe), `2026-09-22-headless-client-handover.md`
- 09-16 plan: `origin/claude/sp-executable-data-model-gewi7j`,
  `docs/plans/2026-09-16-work-api-mcp-and-headless-device.md`
- PR #10251: `electron/mcp/mcp-protocol.ts`, `mcp-tools.ts`
- Code, master `f2adf1e12f`: `native-capture-importer.service.ts`,
  `sync-trigger.service.ts`, `encryption-password-change.service.ts`,
  `local-only-sync-settings.util.ts`, `contributor-sync-model.md` (sync-epoch
  fence), `eslint.config.js:440`; super-sync-server `auth.ts`, `server.ts`
  (helmet CSP, rate limiter), `sync/sync.routes.ts`, `sync/cleanup.ts`,
  `docs/backup-and-recovery.md`
- [Claude connector authentication](https://claude.com/docs/connectors/building/authentication.md),
  [Adding a custom connector](https://claude.com/docs/connectors/custom/add-unlisted.md),
  [Claude Code MCP](https://code.claude.com/docs/en/mcp),
  [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web),
  [Anthropic IP addresses](https://platform.claude.com/docs/en/api/ip-addresses),
  [MCP authorization 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization),
  [MCP security best practices](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices),
  [ChatGPT custom MCP servers](https://developers.openai.com/api/docs/guides/custom-mcp-server),
  [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
  [Cursor MCP](https://cursor.com/docs/context/mcp)
