/**
 * #9863 (follow-up finding): replaying the op-log from seq 0 used to drop every
 * task that lived on the device BEFORE the legacy `pf` → op-log migration.
 *
 * The migration writes a single MIGRATION genesis op whose payload is the
 * entire pre-migration state, and then dispatches `loadAllData` directly. No
 * reducer handles the genesis action type, so a rebuild from the log (corrupt
 * snapshot → #7892 path, or the #9140 fallback) reconstructed only what came
 * AFTER the migration — and the corrupt-snapshot path then persisted that.
 *
 * The bulk meta-reducer now replays the client's OWN genesis op as a full-state
 * `loadAllData`. It must stay inert for any OTHER client's genesis op (#9921)
 * and when the local client id is unknown.
 *
 * Drives the REAL apply chain: `bulkApplyOperations` →
 * `bulkOperationsMetaReducer` → `taskSharedCrudMetaReducer` → `taskReducer`,
 * with the genesis op built exactly as `OperationLogMigrationService` does.
 */
import { Action, ActionReducer } from '@ngrx/store';
import { bulkOperationsMetaReducer } from '../../apply/bulk-hydration.meta-reducer';
import { bulkApplyOperations } from '../../apply/bulk-hydration.action';
import { ActionType, Operation, OpType } from '../../core/operation.types';
import { SINGLETON_ENTITY_ID } from '../../core/entity-registry';
import { taskSharedCrudMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer';
import {
  createBaseState,
  createMockTask,
} from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { RootState } from '../../../root-store/root-state';
import {
  TASK_FEATURE_NAME,
  taskReducer,
} from '../../../features/tasks/store/task.reducer';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { createValidAppData } from '../../validation/state-validity-test-utils';
import { CURRENT_SCHEMA_VERSION } from '../../persistence/schema-migration.service';

describe('MIGRATION genesis op replay-from-scratch (#9863)', () => {
  const CLIENT_ID = 'legacy-client';
  const PRE_MIGRATION_TASK_ID = 'task-from-before-the-update';
  const POST_MIGRATION_TASK_ID = 'task-created-after-the-update';
  const FOREIGN_TASK_ID = 'task-from-another-device';

  // Real feature reducer for the task slice; everything else passes through.
  const featureReducer: ActionReducer<RootState, Action> = (state, action) => {
    const current = state ?? createBaseState();
    return {
      ...current,
      [TASK_FEATURE_NAME]: taskReducer(current[TASK_FEATURE_NAME], action),
    };
  };
  const rootReducer = bulkOperationsMetaReducer(
    taskSharedCrudMetaReducer(featureReducer),
  ) as ActionReducer<RootState, Action>;

  const preMigrationTask = createMockTask({
    id: PRE_MIGRATION_TASK_ID,
    title: 'Existed on Android before the op-log migration',
  });

  // Mirrors OperationLogMigrationService._performMigration step 4.
  const createGenesisOp = (): Operation => ({
    id: 'genesis-op',
    actionType: ActionType.MIGRATION_GENESIS_IMPORT,
    opType: OpType.Batch,
    entityType: 'MIGRATION',
    entityId: SINGLETON_ENTITY_ID,
    payload: createValidAppData({
      task: {
        ...createBaseState()[TASK_FEATURE_NAME],
        ids: [PRE_MIGRATION_TASK_ID],
        entities: { [PRE_MIGRATION_TASK_ID]: preMigrationTask },
      },
    }),
    clientId: CLIENT_ID,
    vectorClock: { [CLIENT_ID]: 1 },
    timestamp: 1_000,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  });

  // Same payload, but as a full-state op type the replay already understands.
  const createSyncImportOp = (): Operation => ({
    ...createGenesisOp(),
    id: 'sync-import-op',
    actionType: ActionType.LOAD_ALL_DATA,
    opType: OpType.SyncImport,
    entityType: 'ALL',
  });

  const createAddOp = (opts: {
    id: string;
    taskId: string;
    title: string;
    clientId: string;
    timestamp: number;
  }): Operation => ({
    id: opts.id,
    actionType: ActionType.TASK_SHARED_ADD,
    opType: OpType.Create,
    entityType: 'TASK',
    entityId: opts.taskId,
    payload: {
      actionPayload: {
        task: createMockTask({ id: opts.taskId, title: opts.title }),
        workContextId: 'project1',
        workContextType: WorkContextType.PROJECT,
        isAddToBacklog: false,
        isAddToBottom: false,
      },
      entityChanges: [],
    },
    clientId: opts.clientId,
    vectorClock: { [opts.clientId]: opts.clientId === CLIENT_ID ? 2 : 1 },
    timestamp: opts.timestamp,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  });

  const createPostMigrationAddOp = (): Operation =>
    createAddOp({
      id: 'post-migration-add',
      taskId: POST_MIGRATION_TASK_ID,
      title: 'Created after the migration',
      clientId: CLIENT_ID,
      timestamp: 2_000,
    });

  // Another device's op that reached the server BEFORE this client joined.
  const createForeignAddOp = (): Operation =>
    createAddOp({
      id: 'foreign-add',
      taskId: FOREIGN_TASK_ID,
      title: 'Created on another device before this one joined',
      clientId: 'someOtherDevice',
      timestamp: 500,
    });

  // Options object rather than a defaulted param: an explicit `undefined`
  // argument would trigger the default and silently reinstate the client id.
  const replayFromScratch = (
    operations: Operation[],
    { localClientId }: { localClientId: string | undefined } = {
      localClientId: CLIENT_ID,
    },
  ): RootState =>
    rootReducer(
      createBaseState(),
      bulkApplyOperations({ operations, localClientId, isReplayFromEmptyBaseline: true }),
    );

  it('control: a full-state SyncImport op followed by an add keeps both tasks', () => {
    const state = replayFromScratch([createSyncImportOp(), createPostMigrationAddOp()]);

    expect(state[TASK_FEATURE_NAME].ids).toEqual(
      jasmine.arrayWithExactContents([PRE_MIGRATION_TASK_ID, POST_MIGRATION_TASK_ID]),
    );
  });

  it('keeps the pre-migration tasks when the log opens with an own MIGRATION genesis op', () => {
    const state = replayFromScratch([createGenesisOp(), createPostMigrationAddOp()]);

    // The post-migration task proves the replay ran; the pre-migration task
    // is the one that vanishes today.
    expect(state[TASK_FEATURE_NAME].entities[POST_MIGRATION_TASK_ID]).toBeDefined();
    expect(state[TASK_FEATURE_NAME].entities[PRE_MIGRATION_TASK_ID]).toBeDefined();
    expect(state[TASK_FEATURE_NAME].ids).toEqual(
      jasmine.arrayWithExactContents([PRE_MIGRATION_TASK_ID, POST_MIGRATION_TASK_ID]),
    );
  });

  it('keeps a RECOVERY genesis op on the same path as MIGRATION', () => {
    const recoveryGenesis: Operation = {
      ...createGenesisOp(),
      actionType: ActionType.RECOVERY_DATA_IMPORT,
      entityType: 'RECOVERY',
    };
    const state = replayFromScratch([recoveryGenesis, createPostMigrationAddOp()]);

    expect(state[TASK_FEATURE_NAME].ids).toEqual(
      jasmine.arrayWithExactContents([PRE_MIGRATION_TASK_ID, POST_MIGRATION_TASK_ID]),
    );
  });

  // A genesis op is the complete state at the moment THIS client's log began,
  // so it may only stand in for the history when nothing precedes it. Legacy
  // clients (pre-#9921) uploaded their genesis op to SuperSync like any other
  // op, so an account that already held another device's ops keeps the history
  // [B ops…, genesis A, A ops…]. A USE_REMOTE raw rebuild replays exactly that
  // order onto an empty baseline: replacing state at the genesis would discard
  // everything B did before A joined.
  it("leaves an own genesis op inert when another client's op precedes it (raw rebuild of a pre-#9921 history)", () => {
    const state = replayFromScratch([
      createForeignAddOp(),
      createGenesisOp(),
      createPostMigrationAddOp(),
    ]);

    expect(state[TASK_FEATURE_NAME].ids).toEqual(
      jasmine.arrayWithExactContents([FOREIGN_TASK_ID, POST_MIGRATION_TASK_ID]),
    );
    expect(state[TASK_FEATURE_NAME].entities[PRE_MIGRATION_TASK_ID]).toBeUndefined();
  });

  // File providers still upload genesis ops, and their USE_REMOTE hydrates the
  // remote snapshot first and replays the post-snapshot suffix on top. A
  // leading own genesis in that suffix must not replace the hydrated state, so
  // the caller has to declare the empty baseline explicitly.
  it('leaves a leading own genesis op inert when the batch is not declared as replayed from an empty baseline', () => {
    const state = rootReducer(
      createBaseState(),
      bulkApplyOperations({
        operations: [createGenesisOp(), createPostMigrationAddOp()],
        localClientId: CLIENT_ID,
      }),
    );

    expect(state[TASK_FEATURE_NAME].ids).toEqual([POST_MIGRATION_TASK_ID]);
  });

  it('leaves an own genesis op inert when one of its own ops precedes it', () => {
    const state = replayFromScratch([createPostMigrationAddOp(), createGenesisOp()]);

    expect(state[TASK_FEATURE_NAME].ids).toEqual([POST_MIGRATION_TASK_ID]);
  });

  // A genesis op is local bookkeeping, not sync history: another device's
  // genesis must never replace this device's state (#9921).
  it("leaves another client's genesis op inert", () => {
    const foreignGenesis: Operation = {
      ...createGenesisOp(),
      clientId: 'someOtherDevice',
      vectorClock: { someOtherDevice: 1 },
    };
    const state = replayFromScratch([foreignGenesis, createPostMigrationAddOp()]);

    expect(state[TASK_FEATURE_NAME].ids).toEqual([POST_MIGRATION_TASK_ID]);
  });

  // Ownership cannot be established without a local client id, so the op
  // stays inert (the pre-fix behaviour) rather than risking a foreign genesis
  // replacing local state mid-log.
  it('leaves the genesis op inert when the local client id is unknown', () => {
    const state = replayFromScratch([createGenesisOp(), createPostMigrationAddOp()], {
      localClientId: undefined,
    });

    expect(state[TASK_FEATURE_NAME].ids).toEqual([POST_MIGRATION_TASK_ID]);
  });
});
