# Legacy plaintext sync-data eradication plan

> **Status:** Proposed; no production action is authorized by this document
>
> **Scope:** The hosted production SuperSync service only. Client-side
> file-based sync providers (WebDAV, Dropbox, local file storage) are out of
> scope: that data lives on user-controlled storage and is not the operator's
> responsibility. Server file storage is not a concern either: the production
> `dataDir` holds no legacy file-storage directories (operator-confirmed);
> the directories `scripts/clear-data.ts` sweeps are defensive legacy
> handling only. Self-hosted deployments are explicitly out of scope by
> operator decision; the gate ships in the shared image and their legacy data
> is their operators' concern.
>
> **Strategy in one paragraph:** Enforce encrypted-only uploads, notify and
> wait at least 45 days, then delete the accounts that still hold plaintext
> and have gone dormant (the operator accepts that returning users
> re-register), clean-slate the few still-active holdouts, and let old
> backups expire under normal rotation. Everything after the gate is one
> existing script, one small script, and waiting. An optional deferred
> volume migration removes disk-level remnants; without it the claim covers
> database contents, not disk forensics.

## Publication scope

This document is deliberately public; the policy and client impact are
community-facing. Concrete hostnames, backup schedules, and the actual
deadline date belong in a private operations runbook, because until
eradication completes this document also describes where recoverable
plaintext still exists.

## Objective and completion claim

The invariant to reach and keep:

> The SuperSync service retains no known server-readable user-content payload
> or derived application-state snapshot. Every retained operation payload is
> encryption-flagged and has the supported ciphertext transport shape. All
> older copies that could contain plaintext have been destroyed or have
> expired under recorded retention.

Account data and envelope metadata (emails, authentication records, operation
type, entity ids, vector clocks, timestamps, the `isPayloadEncrypted` flag)
remain server-visible; changing that is a separate protocol design.

The plan is complete when:

- new plaintext or missing-flag uploads are rejected before any persistence
  side effect;
- `operations` has no row with `is_payload_encrypted IS NOT TRUE` and every
  retained payload passes the ciphertext transport classifier;
- `user_sync_state.snapshot_data` is null everywhere;
- every recorded legacy backup artifact and the affected-user CSV is
  destroyed or past its recorded expiry; and
- the invariant still holds at 7 days and on a restored post-cleanup backup.

Two honest limits. First, the server holds no E2EE key, so it cannot prove a
base64 string is ciphertext; the gate blocks accidental plaintext, while a
malicious client lying about the flag is out of scope (it requires a
cryptographically verifiable protocol). Second, without the optional volume
migration (Step 5), deleted tuples and rotated-out WAL may linger beneath the
database files until pages recycle; the claim then covers what the database
can return, not what disk forensics on operator-controlled hardware could
recover.

## Counting, and why it matters here

The cleanup list is built from two detectors, run in primary-key batches on a
session without the application `statement_timeout`:

- the flag query: accounts with any `is_payload_encrypted IS NOT TRUE` row or
  a non-null `snapshot_data` (the server only ever caches plaintext state);
- the Step 1 classifier over all retained rows, which also catches rows
  flagged encrypted whose payload is not a canonical-base64 AES-GCM envelope.

Because the cleanup targets enumerated accounts, this list is load-bearing:
its sensitivity equals the completion claim's, so there is no gap between
what the plan can detect and what it removes. The count keeps growing until
the gate deploys (pre-v18.13.0 clients can still upload plaintext), so the
final list is built at the deadline, not before. Plaintext in old backup
generations is handled by expiry, never by enumeration.

## Why this strategy

The recovery design treats clients as the source of truth, per account: an
account whose server sync tables are empty is re-seeded by any client that
holds its data, a path already proven by the accounts-only restore E2E and
the #9444 Force Overwrite work. That, plus two operator decisions, removes
every heavyweight mechanism earlier revisions carried:

- **Dormant users may re-register.** So dormant plaintext accounts need no
  preservation: delete them with the existing `delete-user` tooling (row
  cascade removes their operations and state). No account-only backup, no
  `lastSeq` bookkeeping for the bulk of the list, and their email PII goes
  too, which is data minimization, not collateral.
- **There is time to spare.** So old backups need no destruction sweep; they
  expire under normal rotation on recordable dates. And a long notice period
  shrinks the deletion list for free: after the gate deploys, any still
  active old-client user is loudly forced to update, and updated clients
  convert through the documented Force Overwrite flow.

What remains active at the deadline is the small set of accounts with modern
clients and lingering plaintext deep in history (they sync fine and ignore
notices). Those cannot be deleted (they are live users) and get a per-account
clean-slate instead; their clients detect the reset and re-upload encrypted
state. Clean-slating dormant accounts instead of deleting them would be an
equal-effort alternative if keeping their logins ever mattered; the operator
has said it does not.

Containment is valuable on its own: the Step 1 gate closes the server side of
the class whose client side was closed in v18.13.0 (#8670,
GHSA-9v8x-68pf-p5x7). Ship it regardless of the rest. There is no need to
retry `REINDEX INDEX CONCURRENTLY ix_ops_plaintext`; the audit index was for
discovery, not eradication.

## What must not be simplified

1. The gate rejects **before** any persistence side effect, so a rejected
   upload can never partially land.
2. **The deletion list is the sharpest knife in this plan.** A predicate
   mistake deletes an active user's account. The dormancy cutoff (no sync
   activity for at least 45 days) and the plaintext predicate are reviewed
   together, the list is produced as a dry run first, and the operator
   reviews aggregate counts (and spot-checks activity timestamps) before the
   destructive run. The notice period names the exact criteria.
3. The clean-slate path for the active holdouts preserves each account's
   `lastSeq` (the #9444-verified semantics); deleting rows without it hands
   out duplicate sequence numbers later. Verify the tooling; do not assume
   `scripts/clear-data.ts` as-is.
4. The wipe-and-recover path is proven in E2E before the deadline, including
   a divergent pending local edit on a clean-slated multi-device account,
   with no branch disappearing silently.
5. The verification script gates every "done" claim; nothing is declared
   clean by construction.

## The plan

### Step 1: Encrypted-only ingress gate

The only real engineering in this plan. Keep the wire-format definition in
`@sp/sync-core`, where the AES-GCM envelope layout and `detectFormat()`
already live; expose one small pure transport classifier there and apply it
from both SuperSync upload entry points after the existing request schema
parse, including `SYNC_IMPORT`, `BACKUP_IMPORT`, and `REPAIR` (remove the
legacy plaintext repair exception from the externally reachable path). Do not
tighten the shared response schema: downloads of historical plaintext keep
working until the cleanup, then become impossible because no plaintext rows
remain.

The policy: `isPayloadEncrypted === true` (missing is rejected), a string
payload, canonical base64, decoded length compatible with a supported
envelope (at least 28 bytes legacy, at least 44 bytes Argon2id). Structural
check only; never attempt decryption, never log the value. Reject whole
batches with a stable `E2EE_REQUIRED` code before request fingerprinting,
deduplication, quota work, snapshot preparation, or persistence.

No database constraint ships in this step. The intended CHECK backstop on
`operations` turned out to be undeployable before the cleanup: a `NOT VALID`
CHECK is still enforced on every UPDATE, and the payload-bytes backfill
(`scripts/migrate-payload-bytes.ts`, kept for storage-quota reconciliation)
updates exactly the legacy plaintext rows, so the constraint
would permanently wedge that backfill on any install still holding them. The
`snapshot_data IS NULL` constraint on `user_sync_state` has the same
UPDATE-enforcement problem on every sync. Both backstops therefore land in
Step 3, where the rows they would trip on no longer exist. Until then the
route gate is the only control, and that is sufficient: the two gated routes
are the entire external write surface, and the server has no internal
plaintext writer. The gate itself retires the upload-path plaintext cache
write (encrypted snapshots are never cached); the server-side regeneration
path behind the restore endpoint keeps working for legacy accounts until
Step 3 removes it with the rest of the plaintext restore feature. Do not
bump the sync schema version; this is ingress policy, not replay semantics.

Coordinate with #9439/PR #9444: its E2E seeds a plaintext operation through
the upload path this gate rejects (convert the seed to a direct database
insert), and its Force Overwrite documentation is the supported conversion
path until the cleanup. Before production deploy, spot-check one or two real
pre-v18.13.0 builds against staging to confirm rejection does not silently
discard their local data and retries stay bounded. Two cases belong in that
observation: a retry of an upload that committed BEFORE the gate deployed
(the gate runs before request dedup, so the client receives a 400 for an
upload that durably succeeded; it must not present as data loss), and that
updated clients treat `E2EE_REQUIRED` as terminal rather than blind-retrying
a whole batch wedged behind one bad op.

Suggested files: `packages/sync-core/src/encryption/web-crypto.ts`,
`packages/sync-core/src/index.ts`,
`packages/super-sync-server/src/sync/sync.routes.ops-handler.ts`,
`packages/super-sync-server/src/sync/sync.routes.snapshot-handler.ts`,
`packages/super-sync-server/src/sync/sync.types.ts`.

Done when: route tests cover plain JSON, gzip-compressed, batch, snapshot,
import, and repair uploads; rejection creates no operation, device row,
snapshot cache, storage delta, or dedup result; valid legacy and Argon2id
envelopes are accepted; no payload content in logs or responses; server unit
and PostgreSQL integration suites pass.

### Step 2: Notify and wait at least 45 days

Deploy Step 1, then email the accounts on the current plaintext list: the
deadline, the exact criteria (plaintext data plus 45 days of inactivity means
account deletion; active accounts get a data reset), and the conversion
instructions (update, set an encryption password, reconnect each device, use
the documented Force Overwrite where mixed history wedges the client).
Publish the same guidance in release notes and the wiki. Every conversion
removes an account from the list. Track one aggregate number weekly. Time is
the cheapest risk reducer here; a longer wait means a shorter deletion list.

Done when the deadline has passed and the operator accepts the remaining
counts.

### Step 3: Deadline cleanup

Rebuild the list from both detectors, then:

1. **Dry run:** produce the deletion sublist (plaintext and dormant for at
   least 45 days) and the clean-slate sublist (plaintext and active), review
   aggregate counts and spot-check dormancy timestamps.
2. **Delete** the dormant sublist with the existing `delete-user` tooling.
3. **Clean-slate** the active sublist with `lastSeq`-preserving semantics.
4. **Null** every remaining non-null `snapshot_data`.
5. **Add and validate the database backstops**, now safe because the rows
   they would trip on are gone: a CHECK on `operations`
   (`is_payload_encrypted IS TRUE` and `jsonb_typeof(payload) = 'string'`)
   and `snapshot_data IS NULL` on `user_sync_state`. Notes for that
   migration: prepend `SET lock_timeout = '5s'` (the ALTER takes an ACCESS
   EXCLUSIVE lock on the hottest table and must fail fast, not queue the
   sync path behind it); a firing CHECK writes the failing row, payload
   included, into the PostgreSQL server log at default verbosity, so set
   DB-log retention accordingly and sanitize the app-side catch logging; the
   payload-bytes backfill must be complete first.
6. **Delete the dead plaintext paths** the gate made unreachable and re-run
   the external-write-surface bypass sweep afterward:
   `sync.routes.snapshot-handler.ts` (the `?? false` op default and the
   plaintext cache-delta quota branch), `prepareSnapshotCache` (its
   stringify+gzip is pure overhead for encrypted state; only the byte
   measurement is needed), the `snapshot.service.ts` cache writers,
   `snapshot-generation.service.ts` with the `/restore/:serverSeq` endpoint,
   and the `?? false` defaults in `operation-upload.service.ts`.
7. **Run the verification script** (Step 6); all counts must be zero.

Prove the clean-slate recovery in E2E before the deadline: extend the
existing accounts-only restore and #9444 specs with a server-initiated
per-account clean-slate where two clients each hold a distinct pending edit;
both retain local state, the conflict surfaces rather than a branch silently
vanishing, and all re-uploaded operations pass the classifier. Run the full
SuperSync E2E suite via the scheduled GitHub Actions workflow.

### Step 4: Let old copies expire

Record the expiry date of every backup generation that predates the cleanup,
and verify each date as it passes; do not build a destruction pipeline for
artifacts that delete themselves. Deliberately destroy only what has no
automatic expiry: manual exports and `affected-users.csv`. Confirm the
monitoring store holds only aggregates. Keep as audit evidence only aggregate
counts, timestamps, and confirmation records, never the affected-user rows.
The completion claim closes when the last recorded artifact is gone.

### Step 5 (optional, deferrable): encrypted-volume migration

At any convenient later date: short maintenance stop, logical dump of the
verified-clean database, restore onto a fresh volume with at-rest encryption,
run the verification script against the copy, repoint the application and the
backup jobs, then destroy the old volume once the first new-volume backup
restore-tests green. Identical data and sequence space, so clients never
notice, and a failed migration falls back to the old volume with nothing
lost. Skipping this step leaves the disk-forensics limit stated in the
completion claim; running it also gains at-rest encryption, which the current
deployment lacks.

### Step 6: Verify

One read-only script, run after Step 3, at 7 days, and against a restored
post-cleanup backup:

```sql
SELECT count(*) AS plaintext_or_unflagged_ops
FROM operations
WHERE is_payload_encrypted IS NOT TRUE;

SELECT count(*) AS non_string_payloads
FROM operations
WHERE jsonb_typeof(payload) IS DISTINCT FROM 'string';

SELECT count(*) AS cached_plaintext_snapshots
FROM user_sync_state
WHERE snapshot_data IS NOT NULL;
```

All three must be zero, and because a plaintext string with a true flag
passes them, the script also scans retained payloads in primary-key batches
with the exact Step 1 classifier; the invalid count must be zero. Also
confirm the upload routes still reject, both constraints are validated, and
logs contain no request bodies. Keep all of it off `/health` and readiness
paths; the gate plus validated constraints are the continuous controls.

## Checkpoints

1. **A (gate shipped):** Step 1 live against the production database. No data
   deleted; valuable even if nothing else is approved.
2. **B (deadline passed):** notice period over, remaining counts accepted,
   clean-slate E2E green, dry-run lists reviewed.
3. **C (database clean):** deletions and clean-slates done, constraints
   validated, verification script green live and on a restored backup.
4. **D (claim closed):** last recorded legacy artifact expired or destroyed;
   script green at 7 days. Step 5 may run any time before or after D.

## Approaches explicitly rejected

- **A fleet-wide reset (with or without account preservation), revisions 1
  to 4:** resets every account including converted and always-encrypted
  ones, forces a mass reconnect wave, and (in the account-preserving form)
  requires a bespoke account-only backup path. Targeted cleanup touches only
  the accounts that are the problem.
- **Deleting accounts by inactivity alone:** still rejected. Deletion here
  requires plaintext data AND dormancy AND a passed notice deadline; the
  operator has explicitly accepted that such users re-register.
- **Deleting only `is_payload_encrypted=false` rows inside a kept account:**
  breaks sequence, cursor, and replay assumptions. Whole-account deletion or
  `lastSeq`-preserving clean-slate are the supported granularities.
- **Clearing only `snapshot_data`:** leaves plaintext operations in place.
- **Waiting for the 45-day retention job alone:** it prunes only history
  behind a full-state boundary, so unconverted accounts keep plaintext
  forever; the deadline is what makes waiting terminate.
- **Trusting the flag without the shape check:** the flag is unauthenticated.
- **A manual destruction sweep across every backup system:** more actions,
  more chances to delete the wrong thing than rotation with recorded dates.
- **Keeping an encrypted legacy full dump indefinitely:** the operator-held
  key keeps the content recoverable, so the claim would be false.

## Required human decisions before execution

- Approve the deadline, the notice wording, and the 45-day dormancy cutoff.
- Accept account deletion for dormant plaintext holders (re-registration is
  the recovery path) and the divergent-edit risk for clean-slated active
  accounts.
- Approve the final dry-run counts before the destructive run.
- Decide whether and when to run the optional Step 5 migration, accepting
  the disk-forensics limit if it is skipped.
- Accept that the completion claim closes only when the last recorded backup
  generation expires.

## Revision history

1. First draft, six-perspective review plus an adversarial pass. Strategy:
   fleet-wide accounts-preserving reset with active destruction of every
   legacy copy.
2. 2026-08-05: claims re-verified against the codebase; added shipped-client
   observation, announce-and-wait, #9439/#9444 coordination, the counting
   section; scoped out file-based sync storage (client-side is
   user-controlled; production `dataDir` holds no legacy file storage).
3. 2026-08-05: simplification pass: destruction by retention expiry, load
   rehearsal replaced by a watched reopen, reconnect matrix reduced to one
   divergent-edit reproduction.
4. 2026-08-05: time-to-spare pass: fleet reset replaced by a per-account
   deadline wipe; volume replacement became a deferred routine migration.
5. 2026-08-05: KISS pass under two new operator decisions (self-hosted out of
   scope; dormant users may re-register): dormant plaintext accounts are
   deleted with existing tooling instead of preserved, which removes the
   account-only backup and most `lastSeq` bookkeeping; the volume migration
   became optional with its residual disk-forensics limit stated honestly;
   the deletion-list predicate was promoted to the plan's top-listed risk.
6. 2026-08-05: Step 1 implemented (transport classifier in `@sp/sync-core`,
   gate in both upload handlers, `E2EE_REQUIRED`, route and classifier
   specs) and hardened by a seven-reviewer pass. The review moved the
   database backstops out of Step 1 entirely: a `NOT VALID` CHECK still
   fires on every UPDATE, and the payload-bytes backfill updates legacy
   rows, so both constraints now land in Step 3 together with their
   operational notes (lock timeout, failing-row logging). The review also
   fixed the clean-slate quota gate to stop charging phantom snapshot-cache
   bytes for encrypted uploads, and added the dead-path cleanup checklist
   and the two old-client observation cases now recorded above.
