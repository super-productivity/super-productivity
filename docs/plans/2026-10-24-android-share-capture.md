# Android share without opening the app

Oct 24, 2026 · status: implemented on `ccr-0649ff85-54rq8z`; rev. 2 after a
fresh-context adversarial review of the plan, then a second review of the
implementation (both: § Review)

Sharing a link or text to Super Productivity on Android saves it in
milliseconds and leaves the user in the app they shared from (M1). With
SuperSync capture switched on, the phone also seals the share and uploads it
in the background, so other devices get it on their next sync without the
phone app opening (M2).

## Problem

The `SEND text/*` filter sits on `CapacitorMainActivity` (`singleTask`). Every
share pulls the user out of the browser into Super Productivity and, on a cold
start, waits for the WebView, the Angular bundle and hydration before
`AndroidEffects.createTaskFromShare` dispatches `add` + `addAttachment` (two
ops). Nothing in the share code is slow; the cost is booting the app.

Demand: M1 fixes the reported slowness. M2 is a maintainer request (Oct 24 2026) on top of the shipped agent-capture queue; it adds no setting and only
runs for accounts that already switched capture on. M1 ships useful on its
own. Both landed in one commit: the inbox upload states, the bridge and the
activity are shared, so a split would have meant shipping intermediate
versions of those files. M2 stays inert without capture switched on.

## Prior art

Checked Oct 2026 from vendor docs, not hands-on.

| App                                                              | Opens the app?                          | Edit step                | Offline                    |
| ---------------------------------------------------------------- | --------------------------------------- | ------------------------ | -------------------------- |
| Todoist ([help](https://todoist.com/help/articles/360022131079)) | No, a sheet over the source app         | Name the task, then save | Queued by the app          |
| Raindrop.io ([help](https://help.raindrop.io/mobile-app))        | No, a picker over the source app        | Collection and tags      | Not documented             |
| Super Productivity iOS (`ios-share.service.ts`)                  | No, share extension writes `ShareInbox` | Review, then Save        | Imported on next app start |

Take: never launch the full app for a share; a durable local queue first.
Deliberately don't: an edit sheet. It adds a tap to every share and a second
UI to maintain; the task can be edited in the app.

## Behaviour changes

- A share no longer opens the app. Toast: "Saved to Super Productivity"; a
  blank share toasts "Nothing to save"; a failed write toasts an error.
- Shared tasks go to the **Inbox**, short syntax kept literal, as on iOS and
  for agent captures (was: the last open view). Both paths must produce the
  same task, and the server path can only target the Inbox on released apps.
- A shared URL becomes a `LINK` attachment, as today. Shared plain text
  becomes the task's notes instead of a `NOTE` attachment whose path is the
  text. Title rules stay as today (`buildTaskTitle`, 150-character cap).
- Moving the filter to a new component resets a pinned or ranked share
  target once.

## M1: local share receiver

### `ShareReceiverActivity`

`Theme.NoDisplay`, `excludeFromRecents`, `noHistory`, `taskAffinity=""`,
exported, with the `SEND text/*` filter (removed from `CapacitorMainActivity`).
`onCreate`, entirely inside `try { … } finally { finish() }` (a NoDisplay
activity must finish before `onResume`):

1. `getCharSequenceExtra(EXTRA_TEXT)` (Spanned text is null via
   `getStringExtra`), `EXTRA_SUBJECT`, `EXTRA_TITLE`.
2. Blank text → toast, finish.
3. `SharePayload.build(...)` → `CaptureInbox.addShare(...)`.
4. M2 only: enqueue upload (below).
5. Toast. No Keystore access on this path (M2 reads only plain prefs here).

### Payload (`SharePayload.kt`, pure Kotlin)

The v1 capture payload of `capture-queue.store.ts` `CapturePayload`, used for
the local entry and (M2) the sealed upload:

```json
{
  "v": 1,
  "title": "…",
  "notes": "<shared text>",
  "link": "https://…",
  "createdAt": 0,
  "client": "Android share"
}
```

- `title`: Kotlin port of `buildTaskTitle`: subject, else EXTRA_TITLE, else
  for a link `readableUrl` (host + decoded path), else the first line, else
  "Shared note"; over 150 characters → 147 + "...". Never blank, so released
  apps can import it.
- `notes`: the full shared text, at most 100,000 characters (the iOS limit);
  longer text is cut there.
- `link` (new, optional): the trimmed text when it is a single `http`/`https`
  URL of at most 2048 characters with a host.

`link` is an optional field inside v1: released apps ignore it and still show
the URL in notes. No seal or payload version bump.

### `CaptureInbox`

- `addShare(payload)`: one fsynced, renamed file like `add`, plus `source:
"share"`, `notes`, `link`, `client`.
- `pendingJson()` (read by `getPendingCaptures`, also by older or cached web
  bundles in legacy online mode) **excludes share entries**, so a bundle that
  knows only title captures never imports a share as a bare title.
- `pendingSharesJson()` behind a new bridge method `getPendingShares()`
  returns share entries only (M2: after `takeOverUploads`).
- `ShareIntentQueue` (the previous version's pending share) is migrated into
  share entries on that call, like `WidgetTaskQueue.migrateInto`.

### App

- `AndroidCaptureImportService` imports title captures as today and share
  entries through a second `NativeCaptureSource` (own receipts key) built on
  the agent-capture helpers: `toCaptureTask` + `addInboxTaskAction`, exported
  from `super-sync-capture-source.ts`. `source === 'share'` decides, not field
  presence. Runs on start and every resume (existing effect).
- `toCaptureTask(payload, { notesMaxChars })` gains `link`: kept only when it
  parses with `new URL()`, protocol `http:`/`https:`, at most 2048 characters;
  becomes one attachment `{ type: 'LINK', icon: 'link', path, title }` inside
  the `addTask` task (one op). Notes equal to the link are dropped. The type
  is hard-coded: an `IMG` attachment would autoload.
- Removed: `handleShare$`, `checkPendingShareOnResume$`,
  `createTaskFromShare`, `onShareWithAttachment$`, `getPendingShareData`,
  `flushPendingShareIntent`, `isFrontendReady`, the `SEND` branch in
  `CapacitorMainActivity`. `buildTaskTitle` moves to Kotlin. The status-bar
  re-arm that rode on `triggerGetShareData` moves to `notifyFrontendReady`;
  the old name stays as a native alias for older remote bundles.

## M2: background upload over SuperSync capture

### Decision

When the account has capture on, the phone seals the payload to the
account's capture public key and POSTs it to a new `POST /api/capture/items`
behind the sync `authenticate` (the phone already holds the SuperSync access
token for background reminders). The server stores ciphertext in the existing
`capture_items` queue; any SuperSync device claims and imports it through the
shipped agent-capture path. The server never sees share plaintext.

No new setting: the existing capture switch covers it. Its label stays; one
new translation key (`CAPTURE_SHARE_INFO`) explains that Android shares go
the same way, sealed on the phone. Existing keys keep their meaning, so no
translation goes stale.

### Server: `POST /api/capture/items`

Body `{ id, fingerprint, ciphertext }`, `bodyLimit` 48 KiB:

- `id` canonical UUID; `fingerprint` base64url, ≤ 64; `ciphertext` strict
  canonical base64, decoded length from header + tag (94 bytes) to 32 KiB,
  first byte `0x01`.
- One transaction, lock order of `enqueueCapture`:
  1. lock the active key row; none → `409 switched_off`;
  2. fingerprint differs → `409 key_mismatch`;
  3. a row with this `id` exists: same user → `200 queued` (idempotent
     retry, before the cap); other user → `409 id_conflict`;
  4. per-user pending cap → `409 queue_full`;
  5. insert with `task_id = gen_random_uuid()`, `grant_id = 'app-share'`,
     `created_at = now` (server time: retention deletes by it).
- **`task_id` is never the client id.** The client id is only the
  idempotency key and AAD. A re-send after another device acked and deleted
  the row re-queues it under a new task id, so two devices can never create
  the same task id; the worst case is a duplicate task.
- `grant_id = 'app-share'` is outside `capture_grants`: not listed, untouched
  by a grant revoke, dropped by switch-off and key replacement like every item.
- `GET /api/capture/grants` adds `otherPendingCount` (items without a listed
  grant), so the switch-off confirm counts them; released apps ignore it and
  undercount (documented gap).

### Android

- **Key mirror:** `setCapturePublicKey(spki)` stores the SPKI (not secret) in
  plain prefs; `clearSuperSyncCredentials` clears it too. The effect mirrors
  `sync.captureKey.publicKeySpki` when `captureKey.v === 1` and SuperSync
  credentials are mirrored, else `''`, on every config change including
  remote ones (no `skipWhileApplyingRemoteOps`, like
  `syncReminderSettingsToNative$`).
- **Entry state:** share entries written while a key is mirrored get
  `upload: "pending"`. State changes are compare-and-set under the inbox lock
  with an atomic rewrite (tmp, fsync, rename): `beginUpload(id)` sets
  `sendingAt = now` only while `upload` is pending and no attempt holds the
  entry (`sendingAt` unset or older than 60 s); a transient failure clears
  `sendingAt`; `takeOverUploads` clears `upload` only for entries no attempt
  holds.
- **First attempt from the activity:** on a background thread, right after the
  toast; a cached process usually lives long enough. Also enqueue a unique
  `ShareUploadWorker` (`NetworkType.CONNECTED`, initial delay 30 s,
  exponential backoff, at most 12 attempts, then handed to the app) as the
  retry path. Both are idempotent by id; the CAS
  keeps them from sending at once. No expedited work (it needs a foreground
  service declaration on API < 31).
- **One attempt:** `beginUpload` (gone or not pending → done; held by
  another attempt → retry later); load base URL and token
  (`BackgroundSyncCredentialStore`) and the key (missing → hand to the app);
  seal; POST with a dedicated OkHttp client (`callTimeout` 15 s, well under
  the 60 s lease).
  - `200` → delete the entry.
  - `4xx` other than `408`/`429` → hand to the app.
  - Network error, timeout, `408`, `429`, `5xx` → retry (worker backoff).
- **App open takes over:** `getPendingShares()` first runs `takeOverUploads`
  (pending entries outside a send) and cancels their workers. With the app
  open, a local `addTask` syncs through the normal op path anyway.
- **Seal (`CaptureSeal.kt`, plain JCA):** ephemeral `KeyPairGenerator("EC")`
  P-256; `KeyAgreement("ECDH")`; HKDF-SHA-256 on `Mac("HmacSHA256")` with
  salt = 32 zero bytes (equal to an empty salt; `SecretKeySpec` rejects empty
  keys) and info = `"sp-capture-v1" ‖ ephemeral SEC1 ‖ user SEC1`; SEC1 points
  `0x04 ‖ x ‖ y` with each coordinate left-padded or stripped to exactly 32
  bytes; `AES/GCM/NoPadding`, 128-bit tag, 12-byte random IV, AAD
  `0x01 ‖ UTF-8 id`; wire `0x01 ‖ ephemeral(65) ‖ iv(12) ‖ ct ‖ tag`. Input
  is raw plaintext bytes (org.json key order differs between JVM and Android).
  An internal overload takes the ephemeral scalar, its public point and the
  IV for the pinned vector. Fingerprint: base64url SHA-256 of the SPKI DER,
  no padding.
- Upload only when notes ≤ 8 KiB UTF-8 (server tool limit, re-checked by
  `toCaptureTask` on every importer); a longer share stays local.

## Failure modes

| Case                                                    | Outcome                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Offline share                                           | Worker waits for network; app takes it over on open                                                  |
| Process killed mid-send                                 | Worker retries after the 60 s window; same id, server dedupes                                        |
| Response lost, worker retries                           | `200` from the idempotency check; one task                                                           |
| Response lost, then app takes over                      | Possibly a duplicate task (different ids)                                                            |
| Response lost, another device acks, worker re-sends     | Re-queued under a new task id: a duplicate, never a same-id create                                   |
| Capture off when shared                                 | Local only, imported on next app open                                                                |
| Account switch between share and upload                 | `key_mismatch` → local                                                                               |
| Capture switched off after upload, before any import    | Item dropped with the others; counted in the confirm (new apps)                                      |
| A seal no device can open                               | Stays leased until expiry (agent-capture "Gap"); prevented by the shared-vector test                 |
| Legacy online-mode install (remote bundle, same bridge) | Gets share entries only via `getPendingShares`; an older cached bundle ignores them until it updates |
| `CaptureInbox` write fails                              | Error toast; nothing saved                                                                           |

## Testing

- **Kotlin JVM** (CI `:app:test*UnitTest`): `SharePayload` (title port incl.
  readable URL, 150 cap, link detection, notes cut), `CaptureInbox` share
  entries (filtering, CAS, takeover, `ShareIntentQueue` migration),
  `CaptureSeal` (the vector the server and sync-core specs pin, byte for
  byte; short-coordinate padding; fingerprint; random seals opened by an
  independent Kotlin open side). A live Kotlin-seals/Node-opens round trip
  was dropped: the shared vector already pins every byte of the format.
- **Server** (vitest + pglite): validation, idempotent retry before the cap,
  `id_conflict`, `switched_off`, `key_mismatch`, `task_id ≠ id`, re-send after
  ack gets a new task id, `otherPendingCount`.
- **App unit:** `toCaptureTask` with valid and hostile `link`s, the share
  `NativeCaptureSource`, the key mirror effect.
- **E2E** (`e2e:supersync`): seal a share-shaped payload in Node, POST
  `/api/capture/items` with the client's token, sync: exactly one Inbox task
  with one `LINK` attachment; the same POST again changes nothing.
- The activity and worker need an emulator; covered by the unit tests of their
  pure parts plus a manual check.

## Docs

Wiki `3.05-Web-App-vs-Desktop.md` § "Receive Shared Links and Text on
Android" and `3.02-Settings-and-Preferences.md` (capture setting covers
shares).

## Out of scope

Shared files and images (`SEND` streams), `SEND_MULTIPLE`, an edit sheet,
native upload for other sync providers, acked tombstones (would also remove
the lost-response duplicate).

## Long-term cost

- New public route `POST /api/capture/items`, `otherPendingCount`, and the
  optional `link` payload field: additive, accepted forever once shipped.
- A Kotlin copy of the seal, pinned by the shared vector.
- No persisted-model, op-log or schema change.

## Review

Rev. 1 → rev. 2, fresh-context adversarial review:

- **Fixed:** re-send after ack could create one task id on two devices →
  server-issued `task_id`; no re-id dance. Job vs takeover race → CAS under the
  inbox lock, atomic rewrites, `pendingJson` excludes shares natively (legacy
  remote bundles). Idempotency now before the cap. Switch-off count →
  `otherPendingCount`. Hostile `link` → validated at import, type hard-coded.
  Key mirror must see remote changes and `v === 1`. Title regression →
  `buildTaskTitle` ported. Seal spec completed (info, padding, vector
  overload, raw bytes). Activity failure paths and no
  Keystore on the hot path. Worker latency → first attempt from the activity,
  worker as retry, 15 s timeout. Testing section. Legacy row corrected. Old
  share path retired now with a native migration. Server row details
  (server `created_at`, body limit, strict base64, version byte, 32 KiB).
  Notes no longer cut to 8 KiB locally. A new translation key instead of
  rewording existing ones. Wiki targets.
- **Not fixed, by decision:** demand for M2 is the maintainer's request, not
  an issue; M2 does nothing until capture is switched on. Acked tombstones:
  out of scope.

Implementation review (fresh context, read the branch and diff, ran the
Kotlin JVM, server and package checks):

- **Fixed:** `toLink` used `java.net.URI`, which rejects characters browsers
  send unescaped (`|`, `{`, `^`, a stray `%`), so such links lost their
  attachment → lenient `java.net.URL`, matching the app's `new URL()`.
  `docs/ios-share-extension.md` still described immutable inbox entries and
  missed the share receipts key. Test for the uploader's real content type
  (`application/json; charset=utf-8`). An unexpected exception during an
  attempt now frees the entry at once instead of after the 60 s lease.
- **Not fixed, accepted:** a cached process may be frozen during the first
  attempt (the worker and the lease cover it; worst case the documented
  duplicate). At cold start the key mirror may briefly send `''` before
  config loads; a share in that window stays local. The inbox write runs on
  the main thread (one small fsynced file). `CAPTURE_SHARE_INFO` also shows on
  non-Android platforms, where it still describes what the switch does.
