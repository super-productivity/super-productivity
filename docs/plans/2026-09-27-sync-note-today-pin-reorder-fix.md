# Today note pin/reorder follow-up

The [initial investigation](2026-09-26-sync-note-pin-reorder-reproduction.md)
found successful sync with divergent Today membership. This follow-up fixes
that crossing for updated clients. It does not address the separately reproduced
project-order or Today-unpin safety stops.

## Change and boundary

`noteReducer` now treats a Today reorder as a change of positions within the
current `todayOrder` membership. Members absent from the captured order remain
at the front; captured IDs no longer in Today are excluded. This makes the
observed pin and reorder commute: both application sequences produce
`[newly-pinned, ...reordered-existing-members]`.

The production diff is confined to
`src/app/features/note/store/note.reducer.ts`. Project-order handling, shared
resolvers, action capture, models, schema, wire payloads and dependencies are
unchanged. There are no reissued operations or replay-triggered effects. Current
Today membership is preserved directly, including Today-only notes; it is not
reconstructed from pin flags. This is a sync-correctness change with replay risk,
so the real-client red/green evidence is part of the handoff.

## Baseline and verification

Remote `master` was verified using `git ls-remote` at
`4d4cb8b2d51c8051a5685579a1300fc2e2ed0572`. Local `master` had diverged and was
not used. The investigation commit was rebased onto that remote head, producing
`4da9be81ad0cad3969905a97387498dbfb9e47da`; its original evidence commit remains
`e15ecdf7d4bfc89e8abd5028ab3ab7036541d264`. Runtime-injected `AGENTS.md` was
preserved and excluded from commits.

The original two Today-pin cases failed again on this refreshed baseline at
final state equality, after sync, reload and fresh replay. The new committed
regression then failed in all four combinations of pending-local order/pin and
incoming-newer/older timestamps. Captured operations were concurrent, contained
the actual UI-produced payloads and plural order IDs, and shared no declared
note ID. Each baseline failure was the missing Today member, with note entities
and project order unchanged. There were no setup, drag or timeout failures.

With the fix, all five regression cases passed with zero retries/skips:
the four combinations plus a lost upload response after the request reached
the server. Each checks real drag/pin UI, successful strict sync, unchanged
note entities except the intended pin flag, unchanged project membership,
unique intended Today order, zero pending operations, reload and explicit
fresh-history convergence. The only non-create NOTE operations are the original
pin and reorder;
no new REPAIR/SYNC_IMPORT/BACKUP_IMPORT appears. Artifact inspection independently
confirmed equality of all five live/reloaded/fresh snapshots in every case.

Four focused reducer tests cover pin/order commutativity, stale orders excluding
removed members, repeated-order replay, and the project-context no-op. On the
baseline they produced three failures and one pass; with the fix all four pass.
The raw unpin reducer test does not claim the separate sync safety stop is fixed.
The final fixture also retains a Today-only member whose pin flag is false,
protecting membership independently of that flag. All four tests passed again
after this review follow-up (`unit-final.log`).

Commands actually run (task-specific runners use app 4376, SuperSync 1946,
Karma 9976, Compose project `note-pin-fix-c74ca9`):

```bash
# Before the fix: four expected convergence failures.
SUPERSYNC_E2E_URL=http://127.0.0.1:1946 E2E_REQUIRE_SUPERSYNC=true \
  node_modules/.bin/playwright test \
  --config /tmp/note-pin-fix-20260926/playwright.config.cjs \
  --grep-invert 'lost upload response'
# With the fix: five passed.
SUPERSYNC_E2E_URL=http://127.0.0.1:1946 E2E_REQUIRE_SUPERSYNC=true \
  node_modules/.bin/playwright test \
  --config /tmp/note-pin-fix-20260926/playwright.config.cjs
npm run test:file src/app/features/note/store/note.reducer.spec.ts -- \
  --karma-config /tmp/note-pin-fix-20260926/karma.config.cjs
```

`npm run checkFile` passed for the reducer, reducer spec, committed E2E spec
and temporary compatibility diagnostic. The E2E specs also passed strict
standalone TypeScript checking with `--noEmit --target ESNext --module ESNext
--moduleResolution node --esModuleInterop --skipLibCheck --strict --baseUrl .
--types @playwright/test`. An initial Karma override error, sandbox-blocked
process launches and a unit fixture naming lint error were corrected; none is
counted as baseline bug evidence. No full provider suites were run.

## Released-client boundary

Compatibility uses unmodified v19.1.0 APK assets, independently byte-matched
across all 1,229 files. Release tag commit:
`42ded9f31a132bf92633b0c78ad4ebf1d87c0f71`; APK SHA-256:
`127af90995763d88a502eae428af9dc395dcdf17d3f8f1be498f56dfa4aab9dc`.
Provenance is the official
[v19.1.0 APK](https://github.com/super-productivity/super-productivity/releases/download/v19.1.0/app-play-release.apk),
the local artifact hash and byte comparison, not embedded VCS metadata. Requests
from the served asset report appVersion 19.1.0.
GitHub's release API digest and size also matched the tested APK.

The isolated diagnostic exercises the released app as both a real UI producer
and a receiver, with the released client uploading first. The updated client
preserves membership in both cases. A released pin producer receiving the stale
order retains the old missing-membership bug, including reload and fresh old
history replay. **Mixed-version convergence is therefore not guaranteed.**
The fix emits the same ordinary operations as before; it does not add a new
format or cause the old reducer's existing failure. Fixing an unmodified old
binary would require a separately designed sync mechanism. Every receiver must
run the corrected reducer for this convergence guarantee.

Both diagnostic cases passed their explicit boundary assertions; that is not a
claim of mixed-version convergence:

| Released producer | Server sequence | Updated Today | Released live/reload/fresh Today |
| ----------------- | --------------- | ------------- | -------------------------------- |
| Reorder           | Order then pin  | `[a,w,b,t]`   | `[a,w,b,t]`                      |
| Pin               | Pin then order  | `[a,w,b,t]`   | `[w,b,t]`                        |

The first diagnostic run hit an immediate DOM assertion while a Today-only row
was leaving the project view. Replacing it with an eventual order assertion
fixed the test's animation race; that initial failure is excluded from sync
evidence. The corrected two-case run passed without retries or skips.

```bash
COMPAT_OLD_ASSETS=/tmp/sync-s2-release-v19.1.0/assets/public \
  SUPERSYNC_E2E_URL=http://127.0.0.1:1946 E2E_REQUIRE_SUPERSYNC=true \
  node_modules/.bin/playwright test \
  --config /tmp/note-pin-fix-20260926/compat.config.cjs
```

Already-diverged saved Today lists are not repaired by this change. A current
fresh client can replay intact pin/order history correctly, but a snapshot that
already omitted a pin is a different recovery problem.

## Evidence and review

The focused committed regression is
`e2e/tests/sync/supersync-note-today-pin-reorder.spec.ts`. Temporary runners, raw
synthetic evidence, traces, red/green logs, unit logs and indexes are under
`/tmp/note-pin-fix-20260926/`. `red-evidence-index.json` and
`green-evidence-index.json` identify the exact cases. The compatibility diagnostic
is an artifact, not a normal-suite test asserting that old clients lose data.

The original investigation is also preserved outside system `/tmp` in
`/home/johannes/tmp/sync-note-pin-reorder-evidence-20260926-e15ecdf7d4.tar.gz`.
An independent subagent review found no blocking issues and classified the
released-client failure as preexisting. Its nonblocking suggestion to cover a
Today-only member with a false pin flag was applied to the unit fixture.
The follow-up evidence is preserved at
`/home/johannes/tmp/sync-note-today-pin-reorder-fix-20260927.tar.gz`, with an
adjacent `.sha256` file. It includes the runners, final source copies, review
summary, operation/state evidence and logs. `compatibility.patch` restores the
temporary diagnostic to its original E2E path; it must stay outside normal CI.
For a baseline rerun, copy the committed regression spec into an unchanged
checkout of the recorded baseline before using the red-run command above.
