# Note pin/unpin versus reorder: reproduction evidence

Investigation only; no production fix. The inherited commit was
`9177c3afed6429934632b23de936cda8c6603fde`. The empty task branch was refreshed,
without merging, to the assigned integrated baseline
`db3549b114ed3954f70add9cf8388af676cb2bfb`. Its injected `AGENTS.md` change was
preserved and excluded from this deliverable. The source lead came from audit
`78b8a580f8f8aa9491bf77e7bac6338c3f9e3777`, whose older source baseline was
`f84259fcaa66a9bb9512d1c048a299d230740c04`.

## Findings

Project-note reorder versus pin or unpin, and Today reorder versus unpin, reach
the real multi-entity safety stop in both pending-local directions. Manual sync
opens **Sync: Conflicting Data**. The stop preserves the pending operation and
both devices' note state;
Cancel and restart preserve A's pending intent too. This is a sync availability
failure; no note-content loss was observed at this gate.

Today pinning is a different failure: **both clients report successful sync and
have no pending operations, but their Today lists diverge**. Both retain the
note, its text, Inbox membership and `isPinnedToToday: true`; the client that
applies the concurrent whole-list order after pinning loses the note from its
Today list. Additional manual syncs and reloads do not converge the lists.
No safety error or recovery snapshot is emitted in this case. This corrects any assumption that
all pin/reorder crossings reach the safety stop.

This task establishes reproducible app behavior, not a matching user incident
or a released-version range. `git tag --contains db3549b114ed3954f70add9cf8388af676cb2bfb`
returned no local tags. That does not downgrade a master-baseline failure or
prove that released clients are unaffected.

## Source and test boundaries

The following references describe the tested baseline:

- [Note control](../../src/app/features/note/note/note.component.html) →
  `NoteComponent.togglePinToToday()` →
  [NoteService.update](../../src/app/features/note/note.service.ts) dispatches
  `[Note] Update Note` with exactly `{ note: { id, changes: { isPinnedToToday } } }`.
  There is no content or modified-time write in this UI action.
- [Real CDK drop](../../src/app/features/note/notes/notes.component.ts) →
  `NoteService.updateOrder()` dispatches `[Note] Update Note Order` with the
  entire visible list and active context. [Capture metadata](../../src/app/features/note/store/note.actions.ts)
  declares `NOTE`, `MOV`, plural `entityIds`, and `isBulk: true`; the first ID
  becomes the operation's primary ID. Pin uses `NOTE`, `UPD`, one ID.
- [Project reducer](../../src/app/features/project/store/project.reducer.ts)
  writes `project.noteIds` for a project reorder. The
  [note reducer](../../src/app/features/note/store/note.reducer.ts) replaces
  `note.todayOrder` for a Today reorder. Pin/unpin writes the note flag **and**
  prepends/removes its ID in `todayOrder`, leaving project membership unchanged.
- [Work-context selector](../../src/app/features/work-context/store/work-context.selectors.ts)
  exposes `todayOrder` as Today's visible note IDs. This differs from virtual
  Today **task** membership: the note list is not rebuilt from the pin flags.
- [Reorder admission](../../src/app/op-log/sync/reorder-conflict.util.ts)
  accepts note updates containing only `content`/`modified`; pinning is explicitly
  excluded. [Conflict detection](../../src/app/op-log/sync/conflict-resolution.service.ts)
  compares operations on their declared IDs. For overlapping concurrent pending
  operations, `_resolveConflictsWithLWW()` calls `_assertMultiEntityPlansAreSafe()`
  before reconciliation, rejection, or application. Unsupported plural note
  orders throw `UnsupportedMultiEntityConflictError` on either side.
- [Sync wrapper](../../src/app/imex/sync/sync-wrapper.service.ts) sets ERROR and
  opens the whole-dataset conflict dialog for this error on manual sync. The
  automatic-sync snack path was not exercised.
- The Today-pin target is absent from the order's declared IDs, so its shared
  `todayOrder` write is invisible to per-note conflict detection. Both operations
  are accepted, then the raw order reducer overwrites a newly pinned membership
  on the receiving device. [Note validation](../../src/app/op-log/validation/is-related-model-data-valid.ts)
  checks that IDs in `todayOrder` exist; it does not require a project note with
  `isPinnedToToday: true` to appear there. This explains why validation does not
  repair the observed divergence.

## Fixture and method

Two independent Chromium contexts share one fresh test-mode SuperSync account
per case. The app, NgRx reducers, operation capture, IndexedDB, encrypted
transport, server, PostgreSQL, and resolver are real. Only initial notes are
seeded through the existing store-dispatch fixture pattern. Neither conflicting
action is dispatched by the test: order comes from mouse dragging and pin/unpin
from the real note button.

Three notes belong to Inbox: target `a`, sibling `b`, and untouched witness `w`.
A fourth note `t` is a Today-only witness with `projectId: null`. Text, creation
and modification times, IDs, project membership and unaffected pin flags are
checked as complete note entities. Each ID has a per-test suffix. All data and
credentials are synthetic; no user account or external provider is involved.

Project order starts `[a, b, w]`; pin cases start Today at `[b, w, t]`, unpin
cases at `[a, b, w, t]`. Drag swaps the first two visible notes. The target is
therefore a **non-primary** ID in the overlapping reordered list. Today pin
cases intentionally have no target ID in the reorder; the target is pinned
from its project on the other client.

After common-baseline sync, existing E2E flags prevent automatic sync,
immediate uploads and WebSocket downloads. A makes its change first; B makes
the newer change, then uploads first. A syncs with its local operation pending.
Both vector-clock directions and the timestamp inequality are asserted. The
strict helper requires an actual successful download and reports any dialog or
error; it never selects Keep local/remote or calls the permissive `syncAndWait()`
helper during the crossing. Setup's encryption/fresh-account flow runs before
concurrent edits.

Actual rows use schema 4 and `{ actionPayload: ..., entityChanges: [] }`.
Compact codes are `NO` (order) and `NU` (pin). Full synthetic rows, timestamps,
clocks, declared IDs, statuses and before/after snapshots are in `evidence.json`.

## Execution results

The eight-case matrix ran with one worker, zero retries and zero skips. **All
eight desired regressions failed**: six at the successful-sync assertion, two
at final state equality. None failed on server setup, UI dragging, pin control,
operation capture, payload/context/clock checks, or preservation checks.

| Order context | Action | Pending A / incoming B | Observed result                     |
| ------------- | ------ | ---------------------- | ----------------------------------- |
| Project       | Pin    | Order / pin            | Safety stop, local order, 3 IDs     |
| Project       | Pin    | Pin / order            | Safety stop, remote order, 3 IDs    |
| Project       | Unpin  | Order / unpin          | Safety stop, local order, 3 IDs     |
| Project       | Unpin  | Unpin / order          | Safety stop, remote order, 3 IDs    |
| Today         | Pin    | Order / pin            | In sync; A `[a,w,b,t]`, B `[w,b,t]` |
| Today         | Pin    | Pin / order            | In sync; A `[w,b,t]`, B `[a,w,b,t]` |
| Today         | Unpin  | Order / unpin          | Safety stop, local order, 4 IDs     |
| Today         | Unpin  | Unpin / order          | Safety stop, remote order, 4 IDs    |

The six diagnostics are precisely:

```text
UnsupportedMultiEntityConflictError: SYNC_MULTI_ENTITY_UNSUPPORTED side=<local|remote> actionType=[Note] Update Note Order entityCount=<3|4>
```

Each stack enters `_assertMultiEntityPlansAreSafe()` from
`_resolveConflictsWithLWW()`. Parsed A pending rows are identical before the
crossing, after the stop, after Cancel and after restart. Both snapshots stay
unchanged at the stop; A's also survives restart. B has no pending rows after
upload. No new REPAIR/SYNC_IMPORT/BACKUP_IMPORT is created. Successful convergence
assertions remain unexecuted in these six cases; preservation is not recovery.

The Today-pin cases instead finish repeated manual syncs with identical note
entities/project order and empty pending queues, but different Today membership.
Their three-ID reorder is `[w,b,t]`; its declared IDs do not contain `a`.
The first history uploads pin then order; the second uploads order then pin.
This is a list-membership loss, not note deletion: the note remains in Inbox.
There is no recorded content loss, duplicate ID or dataset replacement.

The focused follow-up repeated both Today-pin directions with additional
diagnostics and again failed only at final live-state equality. DOM IDs exactly
match the divergent Today lists. Reload plus another successful sync preserves
each device's state; every queue remains empty. A third fresh client replays
the accepted history and matches B: it omits `a` for pin-then-order, and includes
`a` for order-then-pin. All note entities and project membership remain intact.
This is persisted, user-visible divergence, not a stale DOM or pending-upload
delay. `today-replay-summary.json` indexes the five UI/state captures per case
(`A-live`, `A-reloaded`, `B-live`, `B-reloaded`, `fresh-history`). The original
matrix source is retained separately from the handoff's added diagnostic branch.

The matrix's exact operation IDs, timestamps and paths are indexed in
`/tmp/note-pin-repro-20260926/matrix-summary.json`. For example, the first
project pin case captured order timestamp `1790455758733` and pin timestamp
`1790455759375`; the first Today pin case captured `1790456007581` and
`1790456008652`. The full rows also retain the asserted concurrent clocks.

## Verification and rerun

Only this report is committed. The runnable **red reproduction is not
independently integration-ready** and stays outside the normal E2E suite. The
artifact directory is `/tmp/note-pin-repro-20260926/`:

- `supersync-note-pin-reorder-conflict.patch` restores the isolated spec,
  `e2e/reproductions/note-pin-reorder/playwright.config.cjs`, and `compose.yaml`.
  Its apply check and byte-for-byte restoration comparison passed.
- `matrix-spec.ts` is the exact eight-case matrix source;
  `supersync-note-pin-reorder-conflict.spec.ts` is the handoff source with the
  additional Today UI/reload/history diagnostics.
- `runs/` contains per-case `evidence.json`, `browser.log`, screenshots and
  Playwright traces. `matrix-summary.json` indexes the eight original cases.
  `today-replay-summary.json` indexes the focused follow-up; `SHA256SUMS` records
  the handoff artifacts' hashes.
  Each Playwright worker's runner evaluation creates a timestamped directory;
  consult the index rather than assuming one directory contains the whole run.
- `matrix.log`, `today-replay.log`, `checkFile-final.log`, `typecheck-final.log`,
  `server-build.log` and `app.log` retain command output. Earlier sandbox launch
  failures and the initial lint correction are excluded from runtime evidence.

These artifacts are local and may be removed by host cleanup; preserve them
with the report before cleaning the task. No failing or skipped test is added
to normal CI.

Handoff patch SHA-256:
`328bf2adfbbf47d30010ff7287fc408219d27d9d5c7010fd7803f40f6a56b5ad`.

The task uses app port **4376**, SuperSync port **1946**, and Compose project
`note-pin-repro-c74ca9`; PostgreSQL has no published host port. Its baseline-built
server image is `note-pin-repro:db3549b114`,
`sha256:38147255fae49931e6abb2ed87561756a6eda306ebeeb5961e4550e0b2057747`.
Frontend source is the recorded baseline; Node is 22.18.0 and Playwright 1.61.1.
The dev app logs missing bundled-plugin asset 404s; they did not prevent setup,
UI actions or the asserted sync outcomes.

From a checkout of the tested baseline with dependencies installed, first
confirm both ports are free. The patch supplies all runner/service files:

```bash
git apply /tmp/note-pin-repro-20260926/supersync-note-pin-reorder-conflict.patch
docker build -f packages/super-sync-server/Dockerfile.test -t note-pin-repro:db3549b114 .
docker compose -p note-pin-repro-c74ca9 -f e2e/reproductions/note-pin-reorder/compose.yaml up -d
curl -fsS http://127.0.0.1:1946/health
npm run env
node_modules/.bin/ng serve --host 127.0.0.1 --port 4376
# In another terminal, from the same checkout:
SUPERSYNC_E2E_URL=http://127.0.0.1:1946 E2E_REQUIRE_SUPERSYNC=true \
  node_modules/.bin/playwright test \
  --config e2e/reproductions/note-pin-reorder/playwright.config.cjs
```

The recorded matrix used the identical runner at
`--config /tmp/note-pin-repro-20260926/playwright.config.cjs`. The focused replay
run adds `--grep 'Today pin /'`. A nonzero exit at the documented sync/convergence
assertion is expected on this baseline; setup errors/timeouts are not equivalent.
Stop only these task-owned services afterward and remove the applied red spec
before integrating a checkout.

Checks actually run:

- Eight-case real-server matrix: exit 1 at the eight intended regression
  assertions, as described above; a separate artifact check confirmed all six
  stops' state/pending preservation and both divergent cases' empty queues and
  unchanged entities/project lists.
- Focused Today-pin UI/reload/fresh-history rerun: exit 1 at both final
  convergence assertions, after all diagnostics completed; the independent
  artifact check confirmed preserved reload state, visible membership,
  empty queues, and fresh history matching B in each direction.
- `npm run checkFile e2e/tests/sync/supersync-note-pin-reorder-conflict.spec.ts`:
  passed on the handoff source (formatting and lint). The sandbox's blocked
  child-process attempt was rerun with permission; the initial mixed-arithmetic
  lint errors were corrected.
- `node_modules/.bin/tsc --noEmit --target ESNext --module ESNext --moduleResolution node --esModuleInterop --skipLibCheck --strict --baseUrl . --types @playwright/test e2e/tests/sync/supersync-note-pin-reorder-conflict.spec.ts`:
  passed on the handoff source.
- Runner JavaScript syntax, patch apply/restoration, report source links,
  Prettier and `git diff --check`: passed.

No full provider suites, WebDAV, released clients, or unit/integration suites
were run. Only incoming-newer timestamps were exercised; the other timestamp
winner remains a later-fix validation requirement.

## Later-fix boundaries

Shared resolver work belongs to the habit follow-up. Sequence any fix separately.
This deliverable changes no production, model, schema, wire, action metadata,
dependencies, shared helpers, existing specs, wiki, or agent-control files.

For project order versus pin/unpin, the actual writes are disjoint
(`project.noteIds` versus the pin flag plus `note.todayOrder`). The smallest
candidate to investigate is context-specific handling through the existing
ordering/reissue machinery. That is not permission to add a pin field to an
allowlist: replaying `{ isPinnedToToday: true }` currently prepends the ID again,
so such a replacement is **not** an idempotent local no-op. Test original plus
replacement replay, including released receivers, before selecting a mechanism.

For Today, membership and order share the same list. A stale whole-list write
can omit a new pin or retain an unpinned note. Define the merge behavior before
admitting these operations. Either surviving order is acceptable, but intended
membership, unique IDs, unchanged content/project assignment, and convergence
are required. A larger generic conflict fallback is outside this task.

A later fix must demonstrate the desired assertions red on this baseline and
green with the fix; both directions and timestamp winners; zero pending rows
after successful sync; and no new REPAIR/SYNC_IMPORT/BACKUP_IMPORT. Exercise
restart, fresh history replay, rejected originals plus replacements, interrupted
upload/retry, and missing retained causal evidence. Test an unmodified released
producer/receiver with pinned artifact provenance and record the
old-client-resolves-first limitation. Do not infer compatibility from the
earlier content-only note tests or use a schema bump as protection.
