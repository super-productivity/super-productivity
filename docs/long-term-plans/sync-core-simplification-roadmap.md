# Sync Core Simplification Roadmap

**Goal:** Reduce cognitive load and architectural coupling in the sync stack without destabilizing behavior.

**Primary focus:** Client-side sync orchestration.

**Why now:** The sync implementation is feature-rich and well-tested, but many edge cases accumulated in the orchestration layer. The highest-value work is to simplify control flow and boundaries before doing broader protocol or server refactors.

---

## Target Architecture

1. `SyncWrapperService` remains the application/UI boundary.
2. Sync results use discriminated unions instead of flag bags.
3. Full-state flows are separated from incremental operation sync.
4. Provider capabilities are explicit and narrower.

---

## Priorities

1. Replace flag bags with discriminated unions
2. Extract full-state sync flow from incremental sync
3. Decompose conflict resolution
4. Simplify provider capabilities/contracts (only if warranted)
5. Consider shared protocol schemas only if drift becomes a real maintenance problem

---

## Phase 0: Safety Rails

**Purpose:** Establish a stable baseline before behavior-preserving refactors.

**Required deliverables:** This phase should produce concrete artifacts, not just exploratory notes.

### Checklist

- [ ] Identify the smallest high-signal unit/integration suites for:
  - `src/app/imex/sync/sync-wrapper.service.ts`
  - `src/app/op-log/sync/operation-log-sync.service.ts`
  - `src/app/op-log/sync/remote-ops-processing.service.ts`
  - `src/app/op-log/sync/conflict-resolution.service.ts`
  - SuperSync integration scenarios
  - file-based sync integration scenarios
- [ ] Inventory all current sync result shapes and control flags from:
  - `src/app/op-log/core/types/sync-results.types.ts`
  - `src/app/op-log/sync/operation-log-download.service.ts`
  - `src/app/op-log/sync/operation-log-upload.service.ts`
  - `src/app/op-log/sync/operation-log-sync.service.ts`
  - `src/app/imex/sync/sync-wrapper.service.ts`
- [ ] Write a short design note or ADR for the intended boundary:
  - full-state sync handled separately from incremental sync
  - result types use discriminated unions, not flag bags
- [ ] Produce a markdown table listing every flag/optional field currently used in sync result types and orchestration handoffs
- [ ] Draft a first-pass discriminated union design for incremental sync results

### Exit Criteria

- [ ] Agreed list of current sync outcomes and control flags
- [ ] Markdown table of current flags/optional result fields
- [ ] Draft discriminated union design reviewed and accepted as a starting point
- [ ] Agreed execution order for the refactor phases

---

## Phase 1: Replace Flag Bags With Discriminated Unions

**Purpose:** Reduce branching complexity and make control flow exhaustive and explicit.

**Scope constraint:** This phase applies to the incremental sync path only. Full-state result modeling should be finalized in Phase 2 when those flows are extracted.

### Scope

- `src/app/op-log/core/types/sync-results.types.ts`
- `src/app/op-log/sync/operation-log-download.service.ts`
- `src/app/op-log/sync/operation-log-upload.service.ts`
- `src/app/op-log/sync/operation-log-sync.service.ts`
- `src/app/imex/sync/sync-wrapper.service.ts`

### Checklist

- [ ] Define separate result types for:
  - transport-level download results
  - transport-level upload results
  - incremental orchestration step results
  - incremental sync session results
- [ ] Replace optional fields and combined state flags such as:
  - `cancelled`
  - `serverMigrationHandled`
  - `needsFullStateUpload`
  - `localWinOpsCreated`
  - `snapshotVectorClock`
  - `hasMorePiggyback`
- [ ] Convert wrapper/orchestrator branching to `switch` on `kind`
- [ ] Remove ambiguous combinations of booleans where more than one interpretation is possible
- [ ] Add exhaustiveness checks where practical

### Suggested Result Shapes

- `DownloadTransportResult`
- `UploadTransportResult`
- `IncrementalSyncStepResult`
- `IncrementalSyncSessionResult`

### Exit Criteria

- [ ] Wrapper and orchestrator code branch on tagged results instead of boolean combinations
- [ ] Result types encode mutually exclusive states directly

---

## Phase 2: Extract Full-State Sync Flow

**Purpose:** Remove `SYNC_IMPORT` and related special cases from the incremental op-sync path.

### Scope

- `src/app/op-log/sync/operation-log-sync.service.ts`
- `src/app/op-log/sync/operation-log-download.service.ts`
- `src/app/op-log/sync/operation-log-upload.service.ts`
- `src/app/op-log/sync/server-migration.service.ts`
- `src/app/op-log/sync/sync-import-filter.service.ts`

### New Modules

- [ ] `src/app/op-log/sync/full-state-sync.service.ts`
- [ ] `src/app/op-log/sync/full-state-sync.types.ts`

### Checklist

- [ ] Move full-state responsibilities behind a dedicated service:
  - `SYNC_IMPORT`
  - `BACKUP_IMPORT`
  - `REPAIR`
  - server migration bootstrap
  - provider-switch bootstrap
  - clean-slate flows for encryption/reset cases
- [ ] Centralize the "meaningful local data" checks used for full-state conflict decisions
- [ ] Centralize full-state conflict preparation and resolution input data
- [ ] Keep incremental sync focused on:
  - download ops
  - process ops
  - upload ops
  - retry local-win ops
- [ ] Preserve existing behavior for fresh client, migration, and file-based bootstrap scenarios

### Exit Criteria

- [ ] `OperationLogSyncService` no longer owns most full-state branching
- [ ] Full-state behavior is implemented behind a dedicated service boundary

---

## Phase 3: Decompose Conflict Resolution

**Purpose:** Reduce the size and policy density of the conflict-resolution layer.

**Risk:** Highest-risk phase in this roadmap. `ConflictResolutionService` is tightly coupled to the entity registry, vector-clock utilities, store selectors, and operation application flow. This phase may need its own sub-plan before implementation starts.

### Scope

- `src/app/op-log/sync/conflict-resolution.service.ts`
- `src/app/op-log/sync/remote-ops-processing.service.ts`

### New Modules

- [ ] `src/app/op-log/sync/conflict-strategies/`

### Checklist

- [ ] Extract entity-specific LWW merge logic into separate strategy modules
- [ ] Keep the main conflict-resolution service responsible for:
  - orchestration
  - retries
  - persistence updates
  - batch application coordination
- [ ] Add focused tests per strategy instead of expanding one giant spec file further

### Exit Criteria

- [ ] `ConflictResolutionService` is primarily a coordinator
- [ ] Entity-specific merge behavior is isolated and easier to test
- [ ] A dedicated sub-plan exists if dependency extraction turns out to be larger than expected

---

## Phase 4: Simplify Provider Capabilities

**Purpose:** Reconsider provider contract simplification after the higher-value refactors are complete.

**Status:** Optional reconsideration phase, not a committed refactor. Only pursue this if Phases 1-3 show that the current provider contract is materially contributing to complexity.

### Scope

- `src/app/op-log/sync-providers/provider.interface.ts`
- `src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts`
- `src/app/op-log/sync-providers/wrapped-provider.service.ts`

### Checklist

- [ ] Review whether `OperationSyncCapable` should be split into smaller capabilities such as:
  - op transport
  - snapshot transport
  - remote reset capability
  - sequence cursor storage
- [ ] Avoid forcing file-based sync to mimic server-backed sync where the abstraction adds complexity rather than clarity
- [ ] Keep file-based support behaviorally identical while narrowing contracts
- [ ] Re-evaluate whether wrapper/adaptation boundaries can be simplified after Phase 2

### Exit Criteria

- [ ] Provider contracts reflect actual responsibilities more closely
- [ ] File-based sync is less coupled to SuperSync-style semantics at the type level

---

## Deferred Work

### Shared Client/Server Schemas

Useful, but lower priority than the client orchestration cleanup.

- [ ] Revisit only if response/request drift starts causing real bugs or recurring maintenance pain

### Server Decomposition

Useful later, but not the main bottleneck today.

- [ ] Revisit only if server complexity or deployment needs materially change

---

## Recommended Execution Order

1. Phase 0
2. Phase 1
3. Review checkpoint
4. Phase 2
5. Phase 3
6. Reconsider whether Phase 4 is worth doing at all

---

## Review Checkpoints

### Checkpoint A: After Phase 1

- [ ] Confirm result types are simpler to reason about
- [ ] Confirm no ambiguous result combinations remain

### Checkpoint B: After Phase 2

- [ ] Confirm incremental sync path is visibly simpler
- [ ] Confirm full-state flows are centralized and easier to audit

---

## Validation Strategy

- [ ] Run focused unit tests after each phase for touched services
- [ ] Run op-log sync integration tests after Phases 1 and 2
- [ ] Run targeted SuperSync and file-based E2E scenarios after Phase 2:
  - fresh client
  - provider switch
  - sync import
  - encryption change
  - conflict resolution

---

## First Implementation Slice

If work starts immediately, begin with **Phase 1**.

Reason:

- It delivers the biggest cognitive load reduction (flag bags → exhaustive switches)
- It naturally surfaces where control flow is entangled with result interpretation
- It makes the full-state extraction (Phase 2) easier to design cleanly
