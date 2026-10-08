# Time-delta retry regression reproductions (#10499)

## Requirements

An upload with a missing acknowledgement may already be stored. File providers
retry its original operation ID, clock and payload. SuperSync may rebase kept time
deltas for released-client compatibility, but a duplicate-ID rejection is recovered
only by verifying the original server receipt and restoring its clock atomically
with acknowledgement; see [the recovery contract](time-delta-retry-recovery.md).
Preserve tracked time and task content on every device, after reload and on a fresh
client. Live application and hydration must produce the same Today ordering.
Existing pending rows and interrupted uploads must remain supported.

The repair must preserve the existing field-resolution contracts: no merging
values from LWW resolution rows, and no projection of opaque planning actions
into invented field writes. Check persisted models, the sync wire, released
clients and public APIs explicitly. Do not weaken the preservation oracles.

## Published-head regressions

The fixtures in
`src/app/op-log/testing/integration/sync-fuzz/time-preserving-resolution.fixtures.json`
retain all 30 original executed steps. Seed20725023 includes both originally
observed values of step27's completion toggle. They exercise real capture,
server rejection, download, conflict resolution and hydration through
`SyncFuzzHarness`.

```sh
npm run test:file src/app/op-log/testing/integration/sync-fuzz/time-preserving-resolution.integration.spec.ts
```

| Production revision                                          | Seed07: 7000→4000 ms | Both seed23 variants: C's Today order changes after restart |
| ------------------------------------------------------------ | -------------------- | ----------------------------------------------------------- |
| Audited baseline `d5ccda515a1118fea5cb1cbea7178281c947b1af`  | No                   | No                                                          |
| Original retry PR `8666e5e6a3b9fb4e21962c08d71bd07c04a08e79` | Yes                  | Yes                                                         |
| Original PR with own-successor-only rejection recovery       | Yes                  | Yes                                                         |
| Published head `bc0078cdb8b55b0eff6a93e0fc33575e66d31456`    | Yes                  | Yes                                                         |

The own-successor variant restricts `_findAppliedConflictRow`'s timeless successor
to this client's local row. Removing later mixed-history admission does not fix
these regressions and restores seed23's pre-existing 17000→14000 ms loss.

The browser reproductions in
`e2e/tests/sync/supersync-time-preserving-frozen-traces.spec.ts` confirm all three
published-head failures through the real server, compaction and reload. They
compare full normalized task content, time and ordering; only local arrival
metadata and absent/undefined representation are normalized.

Separate three-tracker reproductions on SuperSync and WebDAV record
A=3000, B=1000, C=5000 ms. Published
production loses 9000→8000 with A→B→C synchronization and 9000→6000 with B→C→A.
These losses predate this PR; they must not be attributed to the retry change.
Each client plans the same initially unscheduled task for Today and records its
contribution while offline, then the clients synchronize twice in the listed
order. The original scripts and their shared helper remain in the continuation's
`pre-existing-tracker-reproduction` evidence directory with restoration commands.
These unresolved experiments are excluded from this PR's new regression specs;
they are not expected-failure tests or evidence of a successful fix.

## Continuation review, 2026-10-04

The PR remains a draft. No continuation has been pushed or merged. The original
frozen cases, lost-response retries, both conflict directions and unchanged
120-case comparison are required before considering a replacement safe. Passing
focused tests alone has repeatedly missed content loss.

### Rejected experiments

- **Whole non-time snapshots:** passed focused browser checks and 4935 op-log
  tests, but introduced nine failure signatures across eight original seeds.
  These include erased notes, lost completion and permanent content divergence.
  Snapshotting unchanged fields invents writes; omitting a losing snapshot can
  leave rejected fields on only one client. This implementation was withdrawn.
- **Never-attempted upload bookkeeping:** passed the original frozen cases and
  120-case comparison for fresh marked rows. All six controls with absent or
  attempted metadata retain the original failures. Attempted state is reachable
  when immediate upload fails before persistence. The prototype does not handle
  existing pending rows or ambiguous attempts completely and was not adopted.
- **Plan commutation:** preserving identical plans and independent content edits
  passed the frozen cases, tracker permutations and retry tests, but introduced
  eight failure categories across six unchanged seeds. Removing a partitioning
  asymmetry fixed one 19000→14000 ms loss while introducing twelve categories
  across eight seeds; all 120 steps matched published production. Browser checks
  also found a future due day changed to Today on both providers. Both variants
  were withdrawn. No failure was waived.

The last experiment additionally exposed a real compaction hazard: an old foreign
Today plan can be pruned while a pending local plan remains. Checking only retained
operations then falsely permits a rebase and produces different Today orders.
A separate two-case reproduction proves the failure and a retained-sequence/cache-
frontier check prevents it. The accepted retry proof below uses the same
completeness requirement for replacements, which can also change relationships.
It does not admit plan commutation.

### Accepted local repairs

A losing TASK replacement is persisted without being applied live. Hydration later
replays it, removing Today membership; the subsequent local winning replacement
adds the task at the end. Routing the same existing replacement pair through the
ordered compensation path makes live application match hydration. No payload,
clock, operation identity or winner changes.

Seed07 needs a separate rejection-recovery change. A pending original time delta
and this client's own replacement can retry together only after the server
explicitly rejects every moved row. The unchanged replacement must already
contain the values of every crossed original title, notes or priority edit.
Incoming resolution values are never merged. The proof checks all retained
history through the state-cache frontier; an earlier stored row is skipped only
when the pending operation's clock strictly covers it. Payloads, IDs and relative
order stay unchanged; only the clocks of verified rejected rows move.

The production changes touch four files because compensation selection was
extracted from the oversized conflict service. That service shrinks by 41 lines;
the extraction preserves existing multi-entity compensation behavior. No planning
action is newly admitted.

### Review

A fresh-context subagent reviewed the repairs and ran the real tests. Findings:

| Finding                                                              | Result                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Published seed07 loses 7000→4000 ms                                  | Fixed; original frozen integration and browser traces pass.                                              |
| Both seed23 variants reorder Today only after restart                | Fixed; original traces and independent disabled-fix control verify the compensation repair.              |
| No-op proof incorrectly ignores `created` and `lastModified` changes | Fixed; only display arrival `modified` is ignored. Negative control failed before the restriction.       |
| Earlier log sequence is incorrectly treated as causal observation    | Fixed; strict clock coverage is required. Earlier concurrent title/notes controls failed before the fix. |
| Pre-existing three-tracker time losses                               | Not fixed; broader approaches were withdrawn after introducing new failures.                             |

The final reviewed production passes all 4944 operation-log tests (two existing
skips), 150 focused tests, and app/spec/E2E type checks. The unchanged 120-trace
comparison adds zero failure signatures against either master
`9a78860f0e769335b67fef4749dec14afe1abb16` or published PR `bc0078cdb8`.
All 120 executed traces match published; the master comparison differs only on
the known seed23 completion toggle, covered separately in both frozen variants.
These comparisons do not claim the baseline is failure-free.

### Compatibility and readiness

No new persisted field, wire action, schema version or public API has been accepted
in this continuation. The discarded snapshot experiment relied on patch clears:
v18.22.0 restores them, whereas v18.21.1 ignores them. Older active resolvers can
also emit time-bearing replacements; a new fix must handle those rows explicitly.

The final reviewed production passes all 14 provider cases: the original three
frozen regressions, five existing upload/lost-response retries, four reminder-clear
direction/provider cases and two incoming-notes cases. There are no skipped cases;
production and test hashes stayed unchanged during the run. After removing the
unresolved tracker experiments from default discovery, both complete reminder/notes
specs pass again (six cases, no exclusions); all five retained specs discover
exactly 14 tests without filtering. All content, time, future scheduling and
restart/fresh-client assertions remain intact. No claim is made that older
clients stop exhibiting their existing resolution bugs; this continuation adds
no new operation semantics or payload shape. Published-head CI does not validate
the unpushed local repairs.
