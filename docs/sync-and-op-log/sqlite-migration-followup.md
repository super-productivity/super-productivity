# SQLite Migration — Follow-up Plan

Companion to [`sqlite-migration.md`](./sqlite-migration.md). That doc holds the
architecture and the per-phase design; this one is the **actionable backlog**
of what remains after the work on branch `claude/issue-7892-root-cause-KY1ED`,
ordered so each item is independently shippable and reviewable.

## Where we are now

- ✅ `OpLogDbAdapter` / `OpLogTx` port + declarative `OP_LOG_DB_SCHEMA`.
- ✅ `IndexedDbOpLogAdapter` (faithful `idb` backend) — the live backend.
- ✅ `OperationLogStoreService` + `ArchiveStoreService` fully routed through the
  port (no direct `this.db`), behind a DI factory token
  (`OP_LOG_DB_ADAPTER_FACTORY`), IndexedDB-backed on every platform today.
- ✅ `SqliteOpLogAdapter` fully implemented against a minimal `SqliteDb` port,
  unit-tested against an in-memory SQLite stand-in. **Not wired to any
  platform; no native plugin dependency.**
- ✅ App-private local backup shipped (#7924): `LocalBackupService` writes a
  JSON snapshot every 5 min on Android (`KeyValStore` rows `backup` /
  `backup_prev`) and iOS (`Directory.Data` `super-productivity-backup.json` /
  `.prev.json`), with an empty-state write guard and a two-generation ring so
  one bad/evicted write cycle can't erase the only good copy. Fresh-launch
  restore prompt is informed (`summarizeBackupStr` shows task / project
  counts). Electron continues to use its own rotated backup folder.

Nothing in the SQLite tracks below changes runtime behavior for existing users
until step B3 flips a platform to the SQLite backend. The #7924 local-backup
work is already live on Android/iOS.

---

## Track A — Ship the #7892 safeguards now (independent of SQLite)

These directly reduce the data-loss blast radius and do **not** depend on the
SQLite work. Highest user value per unit effort; do these first.

### A1. Make `navigator.storage.persist()` observable on native

`startup.service._requestPersistence()` suppresses the not-granted branch on
native and logs nothing when `persist()` resolves `false`. On Android WebView
the grant is often not honored, so today a report like #7892 carries no signal.

- **Do:** `Log.log({ persisted, granted })` on every branch (incl. native), so
  exported logs always carry the durability state of the WebView store.
  Optionally surface in About diagnostics as a follow-up.
- **Size:** ~1 file, a few lines. **Risk:** none (logging only).
- **Payoff:** the next #7892-style report is conclusive instead of a mystery,
  and the telemetry decides whether the next protective steps (e.g. the
  near-empty write guard below) are worth the added complexity.

### A2 (remaining gap). Debounced on-data-change backup trigger

The periodic + app-private backup ring shipped in #7924. The remaining gap is
that the only trigger today is the 5-min `interval()` — so a destructive event
in the minutes before an eviction can be lost from the latest backup even
though the live store had it.

- **Do:** add a debounced "data changed" stream alongside the existing
  `interval(DEFAULT_BACKUP_INTERVAL)` in `LocalBackupService._triggerBackupSave$`
  so high-signal changes (task add/edit/complete, project add/delete) settle
  into a backup within seconds rather than minutes.
- **Size:** small. **Risk:** low (the empty-state write guard already prevents
  a flurry of meaningless writes from clobbering a good backup).

### A3. Near-empty write-time overwrite guard

The empty-state guard in `LocalBackupService._backup()` refuses to overwrite a
good backup with an **exactly** empty store. The residual gap is a store that
boots **near-empty** after eviction, the user adds 1–2 tasks before the 5-min
timer fires, and the degraded state then overwrites the good primary (the prev
slot is still safe, and the informed restore prompt only fires on a wholly
fresh launch — so the user has lost direct access to the better backup until
they uninstall/reinstall).

- **Do:** widen the existing `hasMeaningfulStateData` guard to "**near-empty
  vs. a substantial existing backup**" — e.g. refuse to overwrite an
  ≥N-entity backup with a ≤k-entity one (suggested starting point: refuse
  when `newTaskCount < 3` AND `existingBackupTaskCount >= 10`; counts include
  archived tasks to match `summarizeBackupStr`). Threshold should fail safe:
  skipping a write only delays capturing a real wipe, never loses data.
- **Size:** small. **Risk:** low. The pathological case — user intentionally
  bulk-deletes most tasks — is recovered by them adding more later (the
  guard self-clears once the store grows back above the threshold).
- **Sequence:** **after A1**, so the diagnostics confirm the gap is worth
  closing before tuning the threshold.

> A1 → A2 (remaining) → A3 are the recommended near-term fix for #7892. SQLite
> (Track B) is the durable architectural fix but is weeks of on-device work
> behind these.

---

## Track B — Finish the SQLite backend (native)

### B1. Add `@capacitor-community/sqlite` + a `SqliteDb` wrapper

- **Do:** add the plugin (+ iOS/Android native config), and a ~20-line adapter
  from its `SQLiteDBConnection` to the `SqliteDb` port
  (`run`/`query`). Open one DB named `SUP_OPS` in `Directory.Data`.
- **Gotcha:** the plugin's **web** build is WASM-SQLite persisted into
  IndexedDB — i.e. it reintroduces the eviction risk. Bind SQLite **only** when
  `IS_NATIVE_PLATFORM`; web/PWA/Electron stay on IndexedDB.
- **Size:** small. **Risk:** native build/CI surface.

### B2. Validate `SqliteOpLogAdapter` against a real engine

The current 23 specs use an in-memory stand-in that validates the _translation
layer_, not SQLite itself.

- **Do:** run the adapter once against a real engine. Two options:
  1. **On-device** integration check (most faithful), or
  2. wire **sql.js with a served `.wasm`** into a dedicated Karma run (the
     universal sql.js build statically imports `node:` modules webpack can't
     bundle, so this needs an asset/proxy entry, not the default builder).
- **Do also:** parameterize the existing op-log integration harness to run a
  second pass against `SqliteOpLogAdapter` (the plan's "run the suite against
  both adapters" gate) — catches autoincrement/unique/range/atomicity gaps the
  stand-in can't.
- **Size:** medium. **Risk:** medium — this is where real-SQLite surprises
  surface (collation/ordering of TEXT keys, NULL handling in compound ranges).

### B3. Flip the DI token on native

- **Do:** override `OP_LOG_DB_ADAPTER_FACTORY` to return `SqliteOpLogAdapter`
  when `IS_NATIVE_PLATFORM`, behind a feature flag defaulting **off**.
- **Size:** tiny. **Risk:** gated by the flag.

---

## Track C — Data migration (native, one-time)

### C1. IDB → SQLite copy on first launch after enabling B3

- **Do:** when the SQLite DB is empty/absent **and** a legacy `SUP_OPS`
  IndexedDB exists, copy OPS / STATE*CACHE / VECTOR_CLOCK / CLIENT_ID /
  ARCHIVE*\* across in one SQLite transaction (reuse the IndexedDB adapter's read
  side + the SQLite adapter's write side — both already exist).
- **Verify before commit:** op count, last `seq`, and vector clock match.
- **Keep the IDB copy** untouched for ≥1 release as a fallback; add cleanup
  later. Mirror the proven legacy `pf` → `SUP_OPS` migration pattern.
- **Size:** medium. **Risk:** high (data movement) — mitigated by verify +
  retain-source.

### C2. Staged rollout

Beta/dogfood on real Android devices → staged enable → remove the IDB fallback
and the `adoptConnection` bridge once SQLite is the sole native backend.

---

## Track D — Cleanup (after SQLite is the native default)

- **D1.** Remove the transitional `adoptConnection` bridge from the port and the
  two services once no backend relies on a borrowed connection.
- **D2.** Consider deriving the IndexedDB upgrade from `OP_LOG_DB_SCHEMA` so
  `runDbUpgrade` only carries _deltas_ (the schema spec already guards against
  drift; this removes the remaining hand-maintained duplication).
- **D3.** Out-of-scope for #7892, optional: migrate the other small IDB
  databases (`SUPThemes`, `sup-sync`, `sup-plugin-oauth`) only if fully
  evacuating WebView storage is desired.

---

## Suggested order

1. **A1** (trivial logging; unblocks #7892 diagnosis) → **A2 remaining**
   (debounced data-change trigger) → **A3** (near-empty write guard, threshold
   tuned with A1 evidence).
2. **B1 → B2 → B3** (gets SQLite runnable + validated behind a flag).
3. **C1 → C2** (migrate real users' data, staged).
4. **D** (tidy up once SQLite is the native default).

Tracks A and B/C/D are independent — A can ship while B is still in progress.

## Cross-cutting / hardening

These don't belong to a single track but were surfaced by the #7924 review and
should land alongside the next time the area is touched.

- **`JavaScriptInterface.kt` JS-literal injection** (Android bridge). The
  `loadFromDbCallback(...)` call is built by raw single-quote interpolation of
  the stored value into `evaluateJavascript`. Beyond the security smell, it is
  a real functional bug: `JSON.stringify` does not escape `'`, so a backup
  blob containing an apostrophe terminates the JS string literal and
  load-from-DB returns garbage. Fix is to use `JSONObject.quote()` for the
  arguments (the same primitive already used by
  `emitForegroundServiceStartFailed`).
- **Backup-date in the restore prompt** (strengthens the informed-restore UX
  from #7924). iOS has `Filesystem.stat.mtime` for free; Android needs a
  bridge change to surface the (now-real) `KEY_CREATED_AT` —
  `loadFromDbWrapped(key)` returns only the value, so add a meta-aware reader
  (e.g. `loadFromDbWithMeta` → `{ value, createdAt }`). This gives
  `KEY_CREATED_AT` its first reader; the column is behaviorally inert today.
- **Robust restore on empty/degraded boot** (was #7901 item 4). Today
  `_initBackups()` only offers restore when there is no `stateCache` at all.
  Extend the trigger to also fire when the loaded state is degraded per
  `hasMeaningfulStateData`. Needs a decision on auto-restore vs prompt and a
  guard against resurrecting an intentional wipe (the informed-restore prompt
  shipped in #7924 already lets the user decline knowingly).
- **"Last backup" visibility on mobile** (was #7901 item 5). Surface the
  most recent successful backup time in About / a settings panel so no-sync
  users can see they are protected. Pairs naturally with the backup-date
  bridge change.
- **No-sync onboarding nudge** (was #7901 item 6). On a no-sync mobile
  install, surface that local-only data is at risk and recommend enabling
  sync. Default-on local backup (since #7924) already protects them; this is
  the awareness piece.
