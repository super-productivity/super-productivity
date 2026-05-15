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
- Removing or sharding the `lastSeq` write requires replacing this safety
  mechanism with an equivalent per-user serialization primitive

**Documentation**: [`docs/sync-and-op-log/diagrams/02-server-sync.md`](docs/sync-and-op-log/diagrams/02-server-sync.md)

**Key Files**:

- [`packages/super-sync-server/src/sync/sync.service.ts`](packages/super-sync-server/src/sync/sync.service.ts) - Upload transaction and batch primitive
- [`packages/super-sync-server/prisma/schema.prisma`](packages/super-sync-server/prisma/schema.prisma) - `user_sync_state.last_seq`

**When to Update This Pattern**:

- Changing upload conflict detection
- Changing server sequence assignment
- Changing transaction isolation for upload operations
- Introducing multi-writer or multi-region upload processing

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
