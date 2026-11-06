# Client Version Floor

Lets a SuperSync server someday refuse app versions below a minimum, so that
compensation code kept only for old clients can finally be deleted. Released
clients stay in use indefinitely — the desktop auto-updater is off, and nothing
bounds the fleet ([architecture review §2.7, §3.6](../plans/2026-09-26-sync-architecture-review.md)).
A floor is only humane for devices that already understand it, and clients take
months to reach users. So the client side ships first; **no server enforces a
floor yet**.

## Client contract (shipped)

- **Every SuperSync request carries `appVersion`** as a query parameter, not
  only downloads (#9962). A query parameter needs no new CORS allowance, and
  servers that predate it drop unknown keys.
  (`SuperSyncProvider._buildUrl`, `packages/sync-providers/src/super-sync/super-sync.ts`)
- **Refusal:** any non-2xx response whose JSON body has
  `errorCode: 'CLIENT_UPDATE_REQUIRED'` (`SUPER_SYNC_ERROR_CODES`,
  `packages/shared-schema`), **whatever the status**, throws
  `ClientUpdateRequiredSPError`. The code is checked before the 401/403 branch,
  so a refusal can never count toward the three-strike sign-out.
- **Handling:**
  - Nothing is rejected; the whole request was refused. Pending ops stay pending
    until the app is updated. The snapshot upload re-throws the error instead of
    returning `{ accepted: false }`, which would classify a full-state op as
    rejected (`OperationLogUploadService._uploadFullStateOpAsSnapshot`).
  - Sync status turns `ERROR`, and once per session the user sees
    `VERSION_TOO_OLD` with an "Update App" action
    (`SyncIncompatibleVersionNoticeService`).
  - WebSocket-triggered downloads stop instead of retrying.
  - The error message is fixed: no status, host or server text, so no string
    classifier (retryable, network, quota) can misread it.

## Before a server enforces a floor

Decide these then, with the evidence available at that time:

1. **Floor value:** at least the first release that sends `appVersion` on every
   request. A request without it counts as old, like the checkpoint gate's
   `isCheckpointSafeAppVersion` does.
2. **Coverage:** every sync endpoint — uploads, snapshot, reset, restore,
   downloads and the WebSocket handshake — not only mutations. Clients from
   this release send `appVersion` on the handshake too
   (`super-sync-websocket.service.ts`). Refuse the handshake at the upgrade
   (an HTTP status), not with a close code after it opens: the client then
   reconnects with 1–60 s backoff for up to 50 attempts, while close codes
   4003, 4008 and 4009 stop reconnecting. No handshake refusal has a body the
   client reads, so the notice comes from the next HTTP request.
3. **Never:**
   - 401/403: released clients sign out after three.
   - Per-op rejections inside a 200: they permanently drop that device's edits
     (`rejected-ops-handler.service.ts`).
4. **Status code:**
   - Clients from this release match the code under any status.
   - Released clients classify a non-retryable snapshot-upload error as a
     rejection of their pending full-state op. A retryable-looking status
     (5xx) avoids that, but proxies may replace 5xx bodies, which would hide the
     code from new clients.
5. **Request volume:** a refused client keeps its ops pending and retries.
   `ImmediateUploadService` swallows the error, so each debounced local edit
   still sends one refused upload, and a dropped WebSocket retries its
   handshake with backoff. Size rate limits for that.
6. **Actions outside the sync cycle:** restore points, encryption changes and
   the device list call the server directly. A refusal there shows their own
   generic error, not the update notice. Nothing is lost, since the request is
   refused whole; route them to the notice if that matters by then.
7. **Rollout:**
   - Off by default for self-hosted servers.
   - Advertise the capability the way `supportsCausalRepairSnapshots` does.
8. **File providers are out of scope.** They have no server. Stopping released
   clients there needs a demonstrated per-provider migration (a new format or
   namespace), as the architecture review's Phase 3 describes. A version field
   alone is ignored by released clients.

## Tests

- Provider: `packages/sync-providers/tests/super-sync/super-sync.spec.ts`
  (`client update required`).
- Snapshot path: `operation-log-upload.service.spec.ts`.
- Notice and the pin between the provider constant and the shared code:
  `sync-incompatible-version-notice.service.spec.ts`.
- Wrapper routing: `sync-wrapper.service.spec.ts`.
- WebSocket stop: `ws-triggered-download.service.spec.ts`.
- Version on the WebSocket handshake: `super-sync-websocket.service.spec.ts`.
