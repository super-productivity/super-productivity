# Time-delta upload receipt recovery

## Reproduction and scope

SuperSync can store a time delta while its upload response is lost. The local
operation remains pending. Download conflict resolution then rebases its clock,
and uploading the same ID with that changed clock returns `INVALID_OP_ID`.
The stored-response case in
`e2e/tests/sync/supersync-time-delta-upload-retry.spec.ts` reproduces this through
the real immediate uploader, encrypted server, interrupted response, and reload.

Removing the eager rebase is not sufficient. With v19.1.0, the server can accept
the original concurrent delta without rejecting it. The released receiver then
emits a task replacement whose clock covers that delta but whose time omits it.
The current client applies the replacement and loses its contribution. Both
[run 37215666835](https://github.com/super-productivity/super-productivity/actions/runs/37215666835)
and [run 37217202348](https://github.com/super-productivity/super-productivity/actions/runs/37217202348)
show this loss. A local reproduction after removing only the eager rebase also
confirmed an acknowledged local delta followed by that released replacement.
Both released-client directions pass on the reverted baseline.

## Integration with #10521

The branch retains #10521's time-preserving resolutions instead of carrying the
full #10499 revert onto newer master. Simply dropping the revert reproduced the
released-client failure against `618189a492`, also seen in
[Released Clients run 37233222109](https://github.com/super-productivity/super-productivity/actions/runs/37233222109/job/111527679633):
the pending-loses E2E expected
5,000 ms and received 3,000 ms. The SuperSync-only adaptation makes that same
test pass, including reloads and a fresh receiver.

Only a SuperSync cycle enables eager rebasing of kept time deltas. The cycle's
captured provider supplies the policy for downloads and piggybacked operations;
file providers retain immutable retries. The resolver rebases after remote rows
are durable, while holding the operation-log lock, and rechecks the sync epoch
immediately before the write. Only newly written field-patch resends move after
the deltas. Whole local-win snapshots retain their clocks: moving them later can
make stale fields dominate newer edits. Existing pending resolution rows are
never included: receipt recovery covers only time deltas. Upload selection uses
the same lock, so fresh patches cannot upload before their clocks are final.
Live apply uses the returned rebased operation objects.

The rejection rebase (`rebaseCommutingTimeDeltaRejections`) relies on the same
contract for a pending delta that was not in the rejected batch, e.g. one
tracked while that upload was in flight (#10614). Like kept deltas, its clock
is restored only if this tab re-uploads it before another tab acknowledges it;
otherwise the local clock can differ from the stored one, and the unchanged op
id still counts its time once. Other unrejected ops still block it, and file
providers never reach it: they return no conflict rejections.

Keeping a delta pending and rebasing it have separate eligibility rules. #10521's
broader protection remains intact. Eager rebasing uses only merged field-patch
conflicts and concurrent deltas beside readable, non-time-writing remote winners.
Local winners and opaque timeless snapshots are excluded. The broader candidate
failed the original `tasks:20725013` browser trace with 15,000 ms expected and
11,000 ms received, and also failed the three-tracker regressions. Its original
30-step trace is retained as `20725013-delta-order`.

Rebasing before persisting the remote rows would be unsafe: a crash could leave
a delta claiming knowledge of an edit that was never stored, causing the next
download to discard that edit. Rebasing all providers would also violate
WebDAV's immutable lost-response contract. Neither approach is used here.

An initial adaptation also rebased new local-win snapshots. The original
`tasks:20725008` fuzz seed and its 30-step encrypted browser reproduction both
showed older notes `A9` replacing newer notes `B27`. Restricting successor rebases
to field-patch resends addresses that causal-order regression; the permanent
`20725008-notes-order` fixture retains the original steps and the notes oracle.

## Recovery contract

Recovery is limited to a `syncTimeSpent` delta rejected with `INVALID_OP_ID`.
An authenticated, decrypted server operation must have the same ID and authored
content; the local clock must strictly dominate its stored clock. A mismatched
payload, author, entity, or other operation field is not an acknowledgement.

The local acknowledgement restores the stored operation's clock atomically with
its synced marker. It preserves the operation ID, sequence, payload, and replay
count. The global and state-cache clocks retain their learned causal history.
The receipt lookup must neither apply downloaded operations nor advance the
normal download cursor. Network or decryption failure must not permanently
reject an operation merely because its receipt could not be checked.
The lookup scans retained server pages only after this rejection; ordinary
uploads do not perform it. Recovery requires finding the matching original.

This uses existing server responses and operation shapes. It adds no persisted
field, sync-wire field, schema version, or plugin API. It does not relax the
server's duplicate-identity validation, and it does not recover arbitrary ID
collisions or historical time already lost to conflict resolution.

## Validation requirements

- Stored and rejected uploads whose responses are lost, including reloads and
  a fresh receiver; tracked time and task content must survive.
- v19.1.0 concurrent unscheduled-task tracking in both conflict directions.
- Mismatched receipts and interrupted lookups must not acknowledge different
  content or discard pending work.
- Atomic acknowledgement, unchanged replay order, and unchanged global clocks.
- Focused upload/persistence tests and the unchanged sync-fuzz comparison
  against the reverted baseline.

## Validation results

Validated locally on 2026-10-04 against reverted baseline `cea86337a9`:

- The final stored-response E2E fails on the baseline with a permanent upload
  rejection and passes with this fix, including reloads and a fresh receiver.
- All seven focused browser cases pass: both lost-response cases, three
  current-client unscheduled-task crossings, and both v19.1.0 directions.
- Upload tests pass (98), acknowledgement tests pass (5), and sync orchestrator
  tests pass (188). The stored-response E2E also passes after the final review fix.
- Sync-fuzz comparison reports no newly failing signatures across 120 seeds;
  all 120 execute identical step counts on the baseline and working tree.
- App/spec TypeScript checks, modified TypeScript file checks, and diff whitespace
  checks pass. The separate E2E TypeScript check encounters a pre-existing
  unresolved `src/app/core/util/vector-clock` import from
  `compact-operation.types.ts`, reached through existing E2E tests.

## Integrated validation against #10521

The final compatibility adaptation was validated against master `658228be60`:

- All 31 browser cases pass: both v19.1.0 directions, current-client crossings,
  stored/rejected lost-response retries, both newly reproduced ordering failures,
  frozen restart traces, and SuperSync/WebDAV time-preserving resolutions.
- The archive CI regression passes after reusing the shared navigation helper.

- The unchanged 120-seed fuzz comparison reports no newly failing signatures.
  119 executed traces match exactly; the `tasks:20725023` difference is covered
  by both existing frozen restart variants.
- 80 conflict-resolution/helper tests, 267 provider-routing/orchestration tests,
  and 108 receipt/uploader/frozen-trace tests pass.
- App and spec TypeScript checks and required modified-file checks pass.
- An independent adversarial review verified the narrowed eligibility contract.
  Its real encrypted crash-before-rebase probe preserved tracked time after
  reload, on a fresh receiver, and on v19.1.0; no speculative guard was added.
  An invalid unit fixture found by that review was corrected to use the actual
  LWW payload shape (`entityChanges: []`).

## Review

A fresh-context review found a race when two tabs acknowledge the same deferred
receipt. The second acknowledgement could fail after the first restored the
original clock. A failing regression test preceded the fix: an already-synced,
unrejected local entry with exactly the original content and clock is now a
no-op. Different content remains rejected. The reviewer independently verified
all five acknowledgement tests.

The review also corrected an orchestrator test expectation and verified that
original receipts reach acknowledgement after piggyback processing. No concrete
review findings remain unresolved. Receipt recovery remains limited to originals
still available in retained server history.
