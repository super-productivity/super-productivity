# Local desktop MCP for Super Productivity

Implementation plan · 22 September 2026 · **rev. 4** · shipped in #10251 (see §8). Revised after three independent reviews: repo claims, external facts, and an implementation-readiness review. The rev. 1–3 history is in git (`git log -p -- docs/plans/2026-09-22-local-desktop-mcp.md`).

**Decision.** Add an opt-in MCP endpoint to the running desktop app. It is served by the existing loopback listener and reuses the REST API's renderer routes for reads. The protocol handler is small and built in-repo, with no new dependency. There is a single credential with explicit scopes. Bounded read access ships first, then Inbox capture. Editing is out of scope until usage shows a need.

**Maintainer decisions (2026-09-22):**

- Build the protocol handler in-repo instead of adding the SDK.
- Use one credential in v1.
- Add `network.server` to the MAS build.
- Make the REST enable flag device-local in a separate PR, landed first.
- Execute all milestones. Each PR's commits stay separate on the working branch so the PRs can be split.

---

## 1. Why, and why this shape

- **Demand.** Two community MCP servers are listed in `community-plugins.json`: ≈120★ and ≈81★. Both pair an external MCP server with an SP plugin the user uploads by hand, which gets the full plugin API; one needs Python (`pip install mcp`), the other `npx` plus the plugin's Node-execution consent (checked 2026-09). First-party support adds four things:
  - scoped credentials (read-only, notes opt-in, capture-only)
  - no plugin upload, and no runtime install for HTTP clients
  - bounded, content-minimal responses
  - supported setup
- **No SDK.** The AGENTS.md dependency rule applies. `@modelcontextprotocol/sdk@1.30.0` pulls in 17 runtime dependencies (express, hono, cors, jose, ajv, …). Neither SDK 1.30 nor 2.0 implements the current 2026-07-28 revision anyway.
- **Protocol: 2025-11-25 ("legacy era") only in v1.** Under the 2026-07-28 `basic/versioning.mdx` §Backward Compatibility rules, a dual-era client falls back to `initialize` when it gets a 400 without a recognised modern error body. A legacy-only server therefore works with every client. v1 never emits the modern-only errors (`-32020`, `-32022`), because they would make a modern client treat the server as modern.
- **Claude Desktop needs stdio.** Its config only accepts stdio entries, and custom connectors run from Anthropic's cloud, so they cannot reach localhost. It is served by a zero-dependency `.mcpb` Node bridge in `tools/mcpb/`. Re-running SP's own binary as a stdio shim was rejected:
  - On Linux the launcher is a shell wrapper.
  - Under Snap on Wayland, the wrapper injects `--ozone-platform=x11`, which Node rejects.
  - It is fragile on AppImage, appx, Flatpak and MAS.

## 2. PR A — device-local REST enable flag + listener status

**Problem (verified).** `misc.isLocalRestApiEnabled` syncs. Other desktops pick it up on their next launch or settings send. `updateLocalRestApiConfig` then silently mints a token and listens. The severity is low (auth-gated), but it is unwanted exposure.

**Storage.**

- Key: `SimpleStoreKey.LOCAL_REST_API_ENABLED` in `electron/simple-store.ts`. This is the existing per-device main-process store; `plugin-node-consent-store.ts` uses it for a security grant.
- **Default OFF, no migration.** Seeding from the synced value would re-enable REST on exactly the devices that received `true` through sync, which is the bug being fixed. There is precedent: `misc.isOverlayIndicatorEnabled` moved to per-device storage without migration.
- Cost: an existing REST user toggles it once. The token file is untouched, so their scripts work again with the same token. This goes in the release notes.

**Main process.**

- `initLocalRestApi()` reads the key and starts the server itself.
- `updateLocalRestApiConfig(cfg)` is removed from `ipc-handlers/app-control.ts`.
- New IPC:
  - `LOCAL_REST_API_GET_STATE` returns `{isEnabled, isListening, error?: 'PORT_IN_USE' | 'PERMISSION_DENIED' | 'TOKEN_STORAGE' | 'UNKNOWN'}`.
  - `LOCAL_REST_API_SET_ENABLED(bool)` persists first, then applies the change, then returns the state. It is a no-op under `SP_FORCE_LOCAL_REST_API`.
- Listen errors `EADDRINUSE` and `EPERM`/`EACCES` are kept in state. They are no longer only logged.

**UI.**

- The misc settings checkbox (`key: 'isLocalRestApiEnabled'`) is replaced by an extended keyless formly type `local-rest-api-token`, renamed to `local-rest-api-settings`. The token field is the existing precedent for an IPC-backed field.
- It shows the toggle, the status/error line and the token.
- `isLocalRestApiEnabled?` stays in the model (rule 11). It is no longer read or written.
- No schema bump, no new persisted field.

**Tests.**

- `local-rest-api.test.cjs`: enable/disable over IPC, persistence, the default OFF, error states.
- `app-control.test.cjs`: settings no longer touch the API.
- Component spec for the settings field.

## 3. PR B — packaging permissions

- **MAS.** Add `com.apple.security.network.server` to `build/entitlements.mas.plist`. The inherit plist is not needed because the listener runs in the main process.
- **Snap.** Add `network-bind` to `snap.plugs` in `electron-builder.yaml`. It auto-connects. Today listening may only work via `browser-support`, which core24 drops.
- **MAS risks and mitigations:**
  - App Review may reject it under 2.4.5(i), "entitlement without matching functionality". Precedent: Iris, 2026-05. Mitigation: ship it in its own release. The review notes name the feature: "Local REST API / assistant access, off by default, Settings → Misc, 127.0.0.1 only". Include screenshots. If rejected, revert this commit only.
  - Attack surface: nothing listens unless the user enables it. The bind is explicitly `127.0.0.1`, which causes no firewall prompt.
  - 2.5.2: SP never writes other apps' configs. 2.4.5(iii): nothing outlives the app.
  - Before merging, confirm the EPERM on a MAS dev build without the entitlement. That is the observed instance.

## 4. REST readiness fix (own commit)

REST and MCP reads return `APP_NOT_READY` until `DataInitStateService.isAllDataLoadedInitially$` has fired. `getIsAppReady()` turns true before data loads. This is checked in the renderer `LocalRestApiHandlerService._routeRequest`, so both surfaces get it. Reads do not wait on sync or remote-apply windows, because no problem has been observed there.

## 5. MCP endpoint (M0–M3)

### Listener

- `local-rest-api.ts` listens while `restEnabled || mcpEnabled`.
- `/mcp` is routed **before** the REST branch. Each surface checks its own enable flag and credential.
- `/mcp` rejects any `Origin`, including `null`. REST behaviour is unchanged.
- The token-file helpers move to `electron/secure-file.ts`, so the MCP credential reuses them: exclusive random temp file, verified 0600, fsync, rename, directory fsync, fail closed.

### Settings and credential

- **simpleStore** `ASSISTANT_ACCESS` holds `{isEnabled, scopes: ('tasks:read' | 'tasks:read_notes' | 'tasks:capture')[]}`. All scopes default off. `read_notes` requires `read`.
- **Credential.** 32 random bytes, base64url, shown in settings. Only a SHA-256 verifier is stored, in `userData/assistant-access-verifier` (0600). Because only the verifier is stored, **the credential is shown only right after it is generated or rotated.** Rotating replaces the verifier.
- **Revoking.** Rotating the credential or disabling access persists first, then swaps state, then calls `closeAllConnections()` if the listener is no longer needed. Scopes are re-checked after the body is read and before forwarding.
- Nothing here syncs, and nothing is in backups.

### Protocol (2025-11-25, stateless, JSON responses)

- **HTTP methods.** POST only. GET and DELETE get 405. Array bodies are rejected with `-32600`. No `Mcp-Session-Id` is issued.
- **`initialize`.** Echoes a requested version from {2025-11-25, 2025-06-18, 2025-03-26}; otherwise it answers 2025-11-25. It returns `capabilities: {tools: {}}` and `serverInfo`. It includes no `instructions`.
- **Notifications and responses.** A body that is only a notification or a response gets 202 with an empty body. `ping` returns `{}`.
- **`MCP-Protocol-Version` header.** An absent header is accepted. An unsupported value gets 400 with `-32600`.
- **`tools/list`.** Lists only the granted tools. `inputSchema` is always `{type: 'object', properties, additionalProperties: false}`.
- **`tools/call` results.** Bad arguments, business errors and not-ready are `isError: true` results. An unknown tool, unknown method or malformed request is a JSON-RPC error. Successful results carry `structuredContent` (an object) plus a text block.
- **Auth errors.** A 401 carries `WWW-Authenticate: Bearer` with no `resource_metadata`, so clients do not start OAuth discovery.
- **Ids.** String and number ids are echoed exactly.

### Tools

Reads are forwarded to the existing REST routes. The MCP module in main then applies scopes, projection and caps. There is no new renderer query service.

| Tool                          | Input → result                                                                                                 | Scope                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------- |
| `get_status`                  | → `{isReady, apiVersion, grantedScopes}`                                                                       | any                   |
| `list_tasks`                  | `{query?, projectId?, tagId?, includeDone?, limit? (1–100, default 50)}` → `{tasks: TaskSummary[], truncated}` | `tasks:read`          |
| `get_task`                    | `{id, includeNotes?}` → `{task}`. Notes are capped at 8 KB, with a `notesTruncated` flag.                      | `tasks:read` (+notes) |
| `list_projects` / `list_tags` | `{}` → `{projects \| tags: {id, title}[], truncated}`                                                          | `tasks:read`          |
| `create_task`                 | `{title (1–500), notes? (≤8 KB)}` → `{id, status}`                                                             | `tasks:capture`       |

- `TaskSummary` = id, title, isDone, projectId, tagIds, parentId, dueDay, dueWithTime, deadlineDay, deadlineWithTime, timeEstimate, timeSpent.
- Only active tasks. The response is capped at 256 KB.
- Messages use stable codes and never include task content.

### Capture (M4)

- **Context.** The task is always created in the Inbox project. Short syntax is disabled, because a title may contain untrusted content. The active work context contributes nothing: no tags from a tag view, no Today `dueDay`.
- **Implementation.** `createNewTaskWithDefaults({workContextType: PROJECT, workContextId: INBOX_PROJECT.id})`, then a single `TaskSharedActions.addTask` (one user intent, one op), in a small `AssistantCaptureService`. It is not added to the grandfathered `task.service.ts`. `tasks.defaultProjectId` is ignored: Inbox is the explicit capture target.
- **Outcome.**
  1. If `isApplyingRemoteOps()` is true right before dispatch, return `APP_BUSY` with no dispatch. Actions dispatched during remote apply are deferred and uncounted, so the flush below would not wait for them.
  2. Read `hasUnrecoveredPersistFailure()`. If it is already set, return `PERSIST_DEGRADED` with no dispatch.
  3. Dispatch, then `await flushPendingWrites()`.
  4. If the flag flipped, or the flush threw, return `OUTCOME_UNKNOWN`. Otherwise return `created`.
  - Known false negative: another op may be the one that failed.
  - No change to sync internals.
- **Routing.** Main forwards to an internal route. The renderer accepts it only when main marks the payload `source: 'mcp'`, which an HTTP client cannot set.
- **Timeout.** The MCP renderer timeout for capture is 45 s. On timeout, the result is `OUTCOME_UNKNOWN` ("may have been created").
- **No idempotency ledger in v1.** A duplicate Inbox task is visible and harmless ("hardening needs an observed instance").

### `.mcpb` bridge

- **Location.** `tools/mcpb/`, outside the root workspace and outside the packaged app (`electron-builder.yaml` `files` only lists `electron/**` and the Angular dist).
- **Contents.**
  - `server.js`: readline plus `http`, no dependencies. It forwards each JSON-RPC line to `http://127.0.0.1:3876/mcp` with the bearer from `user_config.token` (sensitive). If SP is down, it returns a JSON-RPC error.
  - `manifest.json`.
  - `pack.js`: zips with `fflate`, which is already a root dependency.
- Wiring it as a release asset and offering it for download in-app are follow-ups.

### Settings UI

A second keyless formly field, `assistant-access-settings`, sits below the REST settings in Misc. It has:

- the enable toggle
- scope checkboxes
- generate/rotate credential, with a one-time reveal
- a Claude Code snippet and a generic JSON snippet
- status

Strings are added only to `en.json`, via `T`.

**Cut from v1:**

- the 2026-07-28 branch
- per-path timeouts
- fail-fast on renderer crash
- `instanceId`/`lastSyncAt`
- "Test connection"
- per-client snippets beyond two
- the in-app `.mcpb` download
- IPC sender check and rate limit (no observed instance)

## 6. Commit order (splittable into PRs)

1. PR A: device-local REST flag and status.
2. PR B: MAS entitlement and Snap plug.
3. REST readiness gate.
4. `secure-file.ts` extraction (pure refactor; existing tests stay green).
5. MCP: settings, credential, protocol, read tools, routing, tests.
6. MCP settings UI.
7. Capture.
8. `.mcpb` bridge.
9. Wiki: `3.01-API.md`, `3.02-Settings-and-Preferences.md`.

## 7. Verification

- **Main-process unit tests** (`electron/*.test.cjs`, node:test):
  - protocol conformance: initialize, version echo, 202, 405, batch rejection, id echo
  - auth and Origin
  - scope filtering and enforcement
  - projections and caps
  - routing next to REST
- **Renderer specs:** settings fields, readiness gate, capture outcomes.
- **Manual, still to be done:**
  - Claude Code: `claude mcp add --scope user --transport http superproductivity http://127.0.0.1:3876/mcp --header "Authorization: Bearer <token>"`.
  - Codex.
  - Claude Desktop via `.mcpb`.
  - MAS dev build.
  - Snap.

## 8. Implementation status (2026-10-13)

Implemented on `claude/local-desktop-mcp-review-j0tgjv`. Each group of commits can be split into its own PR in this order:

| PR  | Commits                                                                                                            | Scope                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| A   | `fix(local-rest-api): make the enable switch device-local and report status`                                       | simpleStore switch, default off, state/enable IPC, listen errors in UI |
| B   | `build(mas,snap): allow the opt-in local API listener to bind 127.0.0.1`                                           | Snap `network-bind` only; MAS `network.server` deferred (see below).   |
| C   | `fix(local-rest-api): answer APP_NOT_READY until app data has loaded`                                              | readiness gate for REST and MCP                                        |
| D   | `refactor(electron): extract secret-file helpers…`, then the `feat(assistant-access)` commits and the review fixes | `/mcp` endpoint, tools, capture, settings panel, `.mcpb` bridge, wiki  |

**Verified on 2026-10-13:**

- Electron tests: 395/395, including the protocol, auth split, scopes, revocation, the userData-after-init regression, shared-listener bind retry and an end-to-end run of the stdio bridge.
- Both listener test harnesses prefer TypeScript over compiled JavaScript. New resolution tests failed against existing `.js` siblings before the fix and pass afterwards, including after an Electron rebuild.
- REST settings Karma specs: 14/14. Failed-enable and failed-disable tests click the real checkbox. Both fail when checkbox restoration is deliberately broken and pass after restoration.
- `npm run test:affected`: 17,319 passed in Europe/Berlin; the America/Los_Angeles subset passed 5,761 (14 skipped).
- Electron type-check/build, frontend build, and `checkFile` for all modified TypeScript files pass. The `.mcpb` bundle packs successfully.
- Production frontend on Electron 44.7.0: the isolated-profile smoke passed capture, notes permissions, wrong-key and Host/Origin rejection, restart with both switches enabled, minimize, renderer reload and credential rotation. Linux network namespaces allowed this to run without stopping the user's existing app.
- Official MCP SDK 1.32.1 against that real Electron build: initialization, scoped tool discovery and a tool call passed. The SDK was installed only in a temporary directory.
- The same lifecycle smoke passed against a clean Linux package in a path containing spaces and `#`. The worktree's symlinked dependency layout produced an incomplete package, so this check used a temporary checkout with `npm ci`, repository patches, and the current compiled Electron/frontend assets. No repository dependencies changed.
- Hidden-window lifecycle: reads pass while the packaged window is hidden and after showing it again. Physical tray-icon interaction remains a platform check.
- The installed Codex CLI accepts the documented `url` and `http_headers` configuration as `streamable_http` (`mcp get`, using a placeholder credential and command-line overrides). This validates syntax, not live tool use.

**Earlier verification (not repeated on the latest changes):**

- The official `@modelcontextprotocol/sdk` 1.30 client connects over Streamable HTTP. It negotiates 2025-11-25, lists and calls tools, gets tool errors for bad arguments and `-32602` for unknown tools, and is refused with a wrong key.
- The `.mcpb` manifest validates against the mcpb v0.3 schema.

**Latest changes:**

- Restore checkbox state after a failed IPC save.
- Apply `get_task` archived-project filtering in the renderer through `GET /tasks/:id?source=active`, avoiding a second renderer request.
- Derive REST availability from the requested switch and token-storage failure state; disabling clears a stale storage error.
- Extract tool validation, projections and result helpers into `mcp-tool-kit.ts`.
- Document direct Codex `config.toml` setup separately from the generic JSON snippet.
- Run the assistant lifecycle smoke in the existing packaged-Electron CI workflow, using an isolated profile and XDG directories.

**Readiness assessment (2026-10-13):**

Local implementation and release preparation are complete under the agreed risk profile; no release was performed. Final review found no additional blocking defect in the current changes. Keep the shared listener, independent credentials/scopes, renderer-owned reads and existing task-action capture path. The latest refactors add no dependencies, synced fields or sync-wire changes; the new REST query parameter and upgrade behavior are documented.

Keep the test-file packaging exclusion: the clean packaged application passes the lifecycle smoke without shipping test sources. The new CI step is prepared and its command passed locally; it has not run remotely with these uncommitted changes.

**Accepted risk:** the user explicitly accepts that MCP may not work in the Snap build. Snap confinement verification is non-blocking; no further speculative permission changes are included.

**Unverified compatibility follow-ups (not gates for this local preparation):**

- Claude Code and Codex against a real build.
- Claude Desktop with the packed `.mcpb` on macOS and Windows.
- A MAS dev build: confirm EPERM without the entitlement and listening with it.
  The entitlement was taken back out of this branch so it can ship in its own release after that check (§3). Until then the MAS build shows `PERMISSION_DENIED` when the API is switched on.
- A Snap install (core22), with the accepted risk above.
- Physical tray-icon interaction (minimize, hidden-window reads, show and renderer reload passed).

The repeatable Linux smoke check is `node e2e/electron/assistant-access-smoke.cjs`, after `npm run electron:build` and `npm run buildFrontend:prod:es6`, with port 3876 free. Optionally pass a packaged executable as the first argument. It uses a temporary profile and checks capture, notes permissions, wrong keys, Host/Origin rejection, restart with both switches on, minimize, hide/show, renderer reload and credential rotation. It does not replace the named-client or platform checks above. The browser E2E build has a different base URL and must not be used for this desktop reload check.

**Known verification gap:** disabling in the same tick as a pending `listen()` may skip `stopServer()` before the listening callback runs. No real-app reproduction has been established; do not add a speculative guard without one.

**Follow-ups, not done:**

- Publish the `.mcpb` as a release asset, and add an in-app download.
- Revisit protocol 2026-07-28 once the SDKs and target clients speak it.
- Idempotency keys for capture, only if duplicates are observed.
- Moving the IPC sender check and rate limit out of "known gaps" needs an observed instance first.

**Release notes need:**

- The Local REST API switch is now per device and starts off after the update. Existing users switch it on again; the token is unchanged.
- REST `GET /tasks` excludes tasks of archived projects by default; `source=all` includes them. `GET /tasks/:id?source=active` is new; omitting that parameter preserves the existing single-task behavior.

## Sources

- **MCP spec:** `modelcontextprotocol/modelcontextprotocol` `docs/specification/{2025-11-25,2026-07-28}`.
- **Claude Desktop:** custom connectors support article 11175166; `modelcontextprotocol/mcpb/MANIFEST.md`.
- **Codex:** `codex-rs/config/src/mcp_types.rs`.
- **Apple:** App Review Guidelines 2.4.5 and 2.5.2; the entitlement docs.
- **Snap:** snapd `network_bind.go`.
- **Repository:**
  - `electron/local-rest-api.ts`
  - `src/app/core/electron/local-rest-api-handler.service.ts`
  - `src/app/op-log/sync/operation-write-flush.service.ts`
  - `src/app/op-log/capture/operation-capture.service.ts`
  - `src/app/core/data-init/data-init-state.service.ts`
  - `electron/simple-store.ts`
  - `build/entitlements.mas.plist`
  - `electron-builder.yaml`
