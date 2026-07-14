# Architecture Decision Records

This document tracks significant architectural decisions and patterns in the Super Productivity codebase. When making changes that affect these patterns, reference this document and update it if needed.

## Active Patterns & Decisions

### 1. dueDay/dueWithTime Mutual Exclusivity Pattern

**Status**: ✅ Active (since commit `400ca8c1`, 2026-01-29)

**Decision**: The `task.dueDay` and `task.dueWithTime` fields are mutually exclusive in new data. When setting `dueWithTime`, `dueDay` must be cleared (set to `undefined`). When reading, `dueWithTime` takes priority over `dueDay`.

**Rationale**:

- Prevents state inconsistency bugs where both fields had conflicting values
- Single source of truth for task scheduling
- Simpler state management

**Implementation**:

- **Writing**: Clear `dueDay` when setting `dueWithTime` (in meta-reducers)
- **Reading**: Check `dueWithTime` first; only check `dueDay` if `dueWithTime` is not set (in selectors)
- **Legacy Data**: Old data with both fields works via priority pattern (no migration needed)

**Key Files**:

- [`task.model.ts`](src/app/features/tasks/task.model.ts) - Field definitions with JSDoc
- [`task-shared-scheduling.reducer.ts`](src/app/root-store/meta/task-shared-meta-reducers/task-shared-scheduling.reducer.ts) - Write implementation
- [`work-context.selectors.ts`](src/app/features/work-context/store/work-context.selectors.ts) - Read pattern
- [`planner.selectors.ts`](src/app/features/planner/store/planner.selectors.ts) - Read pattern
- [`task.selectors.ts`](src/app/features/tasks/store/task.selectors.ts) - Read pattern

**When to Update This Pattern**:

- Adding new date/time scheduling fields
- Modifying task scheduling logic
- Working with task selectors that check due dates

---

### 2. TODAY_TAG Virtual Tag Pattern

**Status**: ✅ Active (established pattern)

**Decision**: `TODAY_TAG` (ID: `'TODAY'`) is a **virtual tag** whose membership is determined by `task.dueWithTime` or `task.dueDay`, not by `task.tagIds`. The tag's `taskIds` field stores only the ordering of tasks, not membership.

**Key Invariant**: `TODAY_TAG.id` must NEVER be added to `task.tagIds`

**Rationale**:

- Uniform move operations across all tags (virtual and regular)
- Single source of truth for "today" membership (date fields, not tagIds)
- Self-healing ordering (stale entries automatically filtered)
- Natural integration with planner (which uses date fields)

**Related**: Uses the dueDay/dueWithTime mutual exclusivity pattern (Decision #1)

**Key Files**:

- [`tag.const.ts`](src/app/features/tag/tag.const.ts) - TODAY_TAG definition
- [`work-context.selectors.ts`](src/app/features/work-context/store/work-context.selectors.ts) - Membership computation
- [`task-shared-helpers.ts`](src/app/root-store/meta/task-shared-meta-reducers/task-shared-helpers.ts) - Invariant enforcement

**When to Update This Pattern**:

- Adding new virtual tags
- Modifying tag membership logic
- Working with today's task list

---

### 3. Sync Package Boundary Direction

**Status**: ✅ Active (since May 2026)

**Decision**: Operation-log sync code is split by dependency direction:
`src/app` composes host-specific wiring, `@sp/sync-providers` owns bundled
provider implementations, and `@sp/sync-core` owns framework-agnostic reusable
sync primitives.

**Rationale**:

- Keeps reusable sync algorithms independent of Angular, NgRx, app models, and
  provider implementations
- Prevents provider IDs, app action/entity enums, validation schemas, UI, OAuth,
  and platform bridges from leaking into the core engine package
- Gives boundary lint a clear rule: packages never import app code, and
  providers consume only public sync-core exports

**Implementation**:

- ESLint rejects Angular, NgRx, app, shared-schema, sync-core deep imports, and
  dynamic imports inside package sources
- `@sp/sync-core` has no runtime dependencies and owns vector-clock algorithms
  used by client/server compatibility paths
- `packages/shared-schema` compatibility-re-exports generic vector-clock
  algorithms from `@sp/sync-core`; `@sp/sync-core` must not import
  `@sp/shared-schema`
- `@sp/sync-providers` depends on public `@sp/sync-core` plus provider runtime
  helpers, while app factories inject credentials, platform bridges, validators,
  OAuth routing, and config

**Documentation**: [`docs/sync-and-op-log/package-boundaries.md`](docs/sync-and-op-log/package-boundaries.md)

**Key Files**:

- [`packages/sync-core/src/index.ts`](packages/sync-core/src/index.ts) - Core public API
- [`packages/sync-providers/src/index.ts`](packages/sync-providers/src/index.ts) - Provider public API
- [`eslint.config.js`](eslint.config.js) - Package boundary enforcement
- [`src/app/op-log/sync-providers/sync-providers.factory.ts`](src/app/op-log/sync-providers/sync-providers.factory.ts) - App-side provider composition

**When to Update This Pattern**:

- Moving sync code between app and packages
- Adding a package export or dependency
- Adding a provider implementation or plugin-facing provider contract
- Changing vector-clock ownership or shared-schema compatibility

---

### 4. Batch Uploads Under RepeatableRead

**Status**: ✅ Active (since May 2026)

**Decision**: SuperSync batch uploads derive conflict-safety from the shared
`user_sync_state.lastSeq` row write that reserves server sequence numbers, not
from PostgreSQL RepeatableRead snapshot isolation alone.

**Rationale**:

- PostgreSQL RepeatableRead does not provide full serializable snapshot isolation
- Two concurrent upload transactions can both pass conflict prefetch checks when
  they read the same pre-insert snapshot
- Reserving sequence numbers through one `user_sync_state.lastSeq` row forces
  accepted writers for the same user to serialize on that row lock
- A causal `REPAIR` snapshot must prove that its state includes the current
  server prefix; the same row serializes that base-cursor check with later writes
- If two batches race, the later writer blocks on the row and the transaction
  retry path handles the serialization failure rather than silently accepting
  conflicting operations

**Implementation**:

- Batch upload conflict detection runs in memory against prefetched latest
  entity rows and updates that map as operations are accepted
- Accepted operations reserve one contiguous sequence range with
  `INSERT ... ON CONFLICT ... DO UPDATE SET last_seq = last_seq + delta`
- The batch insert does not use `skipDuplicates`; an unexpected unique conflict
  aborts the transaction and lets the request retry
- `REPAIR` uploads persist `repairBaseServerSeq` on the operation row. The HTTP
  handler rejects an obviously stale base before quota cleanup, and the upload
  transaction repeats the check under `SELECT ... FOR UPDATE` before insertion
- Markerless legacy repairs are compatibility records, not causal boundaries:
  they cannot drive download fast-forward, snapshot trust, history pruning, or
  server-generated restore points; snapshot replay across one fails closed
- Removing or sharding the `lastSeq` write requires replacing this safety
  mechanism with an equivalent per-user serialization primitive

**Documentation**: [`docs/sync-and-op-log/diagrams/02-server-sync.md`](docs/sync-and-op-log/diagrams/02-server-sync.md)

**Key Files**:

- [`packages/super-sync-server/src/sync/sync.service.ts`](packages/super-sync-server/src/sync/sync.service.ts) - Upload transaction and batch primitive
- [`packages/super-sync-server/prisma/schema.prisma`](packages/super-sync-server/prisma/schema.prisma) - `user_sync_state.last_seq`
- [`packages/super-sync-server/tests/integration/repair-causality.integration.spec.ts`](packages/super-sync-server/tests/integration/repair-causality.integration.spec.ts) - Real-PostgreSQL race coverage

**When to Update This Pattern**:

- Changing upload conflict detection
- Changing server sequence assignment
- Changing transaction isolation for upload operations
- Changing repair base-cursor validation or full-state history pruning
- Introducing multi-writer or multi-region upload processing

---

### 5. Project Completion: Decoupled Resolution over Atomic Multi-Entity Op

**Status**: ✅ Active (since 2026-06-06, branch `feat/completing-projects-48eeb4`)

**Decision**: "Complete project" is a **plain single-entity `PROJECT` flag flip** (`completeProject`, `OpType.Update`, mirroring `archiveProject` → sets `isDone`/`doneOn`/`isArchived`). The accompanying resolution of unfinished tasks ("move to Inbox" / "mark done") runs **first, as the normal per-task actions** (`moveToOtherProject` / `updateTask isDone`) dispatched in a loop with the Rule&nbsp;#6 bulk-dispatch flush — **not** bundled into a single atomic multi-entity op.

**Rationale**: An earlier iteration made completion one atomic `Batch` op (`completeProject`) that marked/moved tasks inside the project-shared meta-reducer. Because that op deliberately routed **around** the normal per-task actions, every system that observes those actions had to be re-taught about `completeProject` separately:

- **Conflict detection** needed a whole new `affectedEntities` multi-entity-ref feature threaded through sync-core, the sync server (+ a Prisma migration), shared-schema and the op-log — ~1,565 LOC, of which `completeProject` was the **only** producer.
- **Native-reminder cancellation**, **issue two-way-sync**, **time-block sync** and **repeat-cfg** effects each needed a dedicated `completeProject` listener to re-derive the task changes the atomic op skipped.

The atomic op's headline benefit — reversing the whole thing as one unit — was never realized: `reopenProject` only clears the project flags; it does **not** un-move or un-complete the resolved tasks. So the bundle paid a large cross-cutting cost for an undo guarantee it didn't provide. Decoupling makes the existing effects and per-entity conflict detection fire naturally and deletes ~1,750 LOC total (revert + decouple). Trade-off accepted: completion now emits **N+1 ops** (one per resolved task + the flag flip) instead of one, and there is a brief intermediate state — both fine for a rare, user-initiated action whose resolution is not atomically reversible anyway. One behavioral nuance vs. the old atomic op: when unfinished work is **moved to Inbox**, a task that was being actively tracked stays the current task (it was carried forward, not finished — consistent with Inbox's carry-forward intent); the **mark-done** path stops tracking the current task via the existing `autoSetNextTask$` effect. The atomic op cleared the current task in both cases; the decoupled design intentionally keeps it for the carry-forward case.

**Implementation**:

- **Action/reducer**: `completeProject({ id, doneOn })` in `project.actions.ts`; `on(completeProject)` flag flip in `project.reducer.ts` (guards `INBOX_PROJECT`). `reopenProject` clears the flags only.
- **Service**: `ProjectService.complete(id, doneOn)` dispatches the flag flip; `moveTasksToInbox()` / `markTasksDone()` loop the normal per-task actions + `setTimeout(0)` flush.
- **Flow**: `work-context-menu` resolves unfinished work **before** calling `complete()`.
- **Do NOT** reintroduce a multi-entity `completeProject` op or `affectedEntities` for it without re-justifying the full downstream cost above. Prior atomic implementation is preserved in history at commit `0893a86162`.

**Key Files**:

- [`project.actions.ts`](src/app/features/project/store/project.actions.ts), [`project.reducer.ts`](src/app/features/project/store/project.reducer.ts)
- [`project.service.ts`](src/app/features/project/project.service.ts) — `complete` / `moveTasksToInbox` / `markTasksDone`
- [`work-context-menu.component.ts`](src/app/core-ui/work-context-menu/work-context-menu.component.ts) — `completeProject()` flow

**When to Update This Decision**:

- Adding a true bulk meta-reducer action for general use (revisit whether completion should adopt it)
- Reworking how completion resolves unfinished tasks
- Any proposal to make completion a single synced op again

---

### 6. Passkeys Stay Pending Until Email Verification

**Status**: ✅ Active (since July 2026)

**Decision**: A passkey submitted during account registration is stored as a
`PendingPasskeyRegistration` tied to its exact email-verification token. It is
promoted to the user's active `Passkey` set only when that token is consumed.

**Rationale**:

- A WebAuthn registration ceremony proves possession of a credential, not
  ownership of the email address entered alongside it.
- Storing a submitted credential directly on an unverified user lets an attacker
  pre-register a victim's address, then have the victim's later magic-link
  verification activate the attacker's passkey.
- Keeping separate pending attempts prevents concurrent registrations from
  replacing or activating one another. The email owner chooses the credential
  by consuming the link produced by that same registration attempt.
- Failed email delivery leaves the bounded, expiring pending attempt in place.
  Deleting the shared unverified user can race a concurrent registration and
  invalidate a link that was successfully delivered.

**Implementation**:

- Passkey registration stores no active credential and creates one pending row
  per verification token.
- Email verification atomically claims the unverified user, replaces active
  passkeys with the credential bound to that token, and deletes the user's
  remaining pending attempts.
- Passkey verification tokens live only on pending registrations; user-row
  verification tokens belong to magic-link registrations. Consuming a user-row
  token verifies the email but removes untrusted active and pending passkeys.
- The migration moves the latest legacy credential for each unverified user to
  the pending table and removes all active credentials from unverified users.
- The resend cap bounds pending rows per unverified account; rows also expire
  with their verification tokens.

**Key Files**:

- [`auth.ts`](packages/super-sync-server/src/auth.ts)
- [`passkey.ts`](packages/super-sync-server/src/passkey.ts)
- [`schema.prisma`](packages/super-sync-server/prisma/schema.prisma)

**When to Update This Pattern**:

- Changing passkey enrollment or email-verification flows
- Adding another credential type to registration
- Changing verification-token persistence or cleanup

---

### 7. Versioned Delete-Wins Semantics for Project Deletion

**Status**: ✅ Active (since July 2026)

**Decision**: Project deletions created with schema v4 or newer carry an explicit
`projectDeleteWins` marker and beat concurrent project updates. Historical,
unmarked deletions keep timestamp-based LWW semantics.

This is a deliberate semantic trade-off: a concurrent project rename or field
edit that is vector-clock CONCURRENT with a marked delete **loses**, regardless
of which has the newer wall-clock timestamp. Deleting an entity another device is
editing wins over the edit — the alternative (timestamp LWW) resurrects an empty
project shell and silently loses its task subtree. The lost edit is only
recoverable via local undo, not via sync.

**Rationale**:

- `deleteProject` is one user intent whose reducer cascade removes the project,
  active tasks, notes, sections, repeat configuration, and related archive data.
  Reversing only the project entity after that operation loses data and violates
  replay determinism.
- Capturing every cascaded entity in the delete payload or emitting restoration
  sidecars makes payload size scale with project size and still cannot restore
  every side effect safely.
- Deletion is the only complete, deterministic result already represented by the
  operation. A concurrent rename or project-field edit must not partially undo it.
- The schema-v4 barrier makes clients that do not understand this conflict policy
  stop before applying the operation (they block on the newer-schema gate rather
  than mis-resolving). The **absence** of the payload marker on historical
  deletions — never added by the no-op v3→v4 migration — is what preserves their
  timestamp-LWW semantics; the marker, not the version number, is the real
  discriminator. The classifier additionally requires the marked delete's
  plaintext `entityId` to match its authenticated payload `projectId`, so a
  tampered/replayed delete retargeted onto a live entity cannot win.

**Implementation**:

- New `deleteProject` actions include `projectDeleteWins: true`; replacement
  delete operations preserve that payload.
- The shared LWW planner accepts a host-supplied delete-wins classifier. A remote
  marked delete is applied regardless of timestamps. A local marked delete is
  replaced with one operation whose vector clock dominates both conflict sides.
- SuperSync keeps its generic conflict protocol: if the first delete upload is
  rejected, the existing retry path uploads the causally dominant replacement.
  File-based providers use the same client planner and marker.
- Do not add per-task/note restoration operations or project-sized snapshots to
  compensate a losing marked project delete.

**Key Files**:

- [`task-shared.actions.ts`](src/app/root-store/meta/task-shared.actions.ts) — the `PROJECT_DELETE_WINS_MARKER` producer
- [`conflict-resolution.ts`](packages/sync-core/src/conflict-resolution.ts)
- [`conflict-resolution.service.ts`](src/app/op-log/sync/conflict-resolution.service.ts) — the delete-wins classifier
- [`schema-version.ts`](packages/shared-schema/src/schema-version.ts)
- [`project-delete-wins-barrier-v3-to-v4.ts`](packages/shared-schema/src/migrations/project-delete-wins-barrier-v3-to-v4.ts) (registered in [`migrations/index.ts`](packages/shared-schema/src/migrations/index.ts))

**When to Update This Pattern**:

- Changing the cascade performed by `deleteProject`
- Adding another operation with delete-wins conflict semantics
- Changing schema compatibility or LWW replacement behavior

---

## How to Use This Document

### When Making Architectural Changes

1. **Before implementing**: Check if your change affects any active pattern
2. **During implementation**: Follow the documented patterns
3. **After implementation**: Update this document if you've:
   - Changed an existing pattern
   - Added a new architectural pattern
   - Made a decision that affects future development

### When to Add a New Decision

Add a new decision record when:

- The decision affects multiple files/modules
- Future developers need to understand "why" not just "what"
- The pattern needs to be followed consistently across the codebase
- The decision prevents a specific class of bugs

### Decision Record Template

```markdown
### N. [Pattern/Decision Name]

**Status**: ✅ Active | 🚧 Draft | ⚠️ Deprecated | ❌ Superseded

**Decision**: [One-sentence summary of the decision]

**Rationale**:

- [Why was this decision made?]
- [What problems does it solve?]

**Implementation**:

- [How is it implemented?]
- [Key techniques or patterns used]

**Documentation**: [Link to detailed docs]

**Key Files**: [List of primary files implementing this pattern]

**When to Update This Pattern**: [Scenarios when someone should review/update this]
```

---

## Related Documentation

- [`docs/sync-and-op-log/`](docs/sync-and-op-log/) - Operation log architecture
- [`docs/long-term-plans/`](docs/long-term-plans/) - Future architectural plans

---

## Commit Reference

When committing changes related to these patterns, reference this document and the specific decision:

```
feat(tasks): implement feature X

Uses dueDay/dueWithTime mutual exclusivity pattern (ARCHITECTURE-DECISIONS.md #1)
```
