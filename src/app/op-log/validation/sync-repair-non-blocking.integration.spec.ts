import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateService } from '@ngx-translate/core';
import { ValidateStateService } from './validate-state.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import {
  MixedSourceOperationBatch,
  OperationLogStoreService,
} from '../persistence/operation-log-store.service';
import { LockService } from '../sync/lock.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { HydrationStateService } from '../apply/hydration-state.service';
import { SnackService } from '../../core/snack/snack.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { plannerInitialState } from '../../features/planner/store/planner.reducer';
import { initialTimeTrackingState } from '../../features/time-tracking/store/time-tracking.reducer';
import { initialMetricState } from '../../features/metric/store/metric.reducer';
import { menuTreeInitialState } from '../../features/menu-tree/store/menu-tree.reducer';
import {
  MenuTreeKind,
  MenuTreeState,
} from '../../features/menu-tree/store/menu-tree.model';
import { environment } from '../../../environments/environment';
import { T } from '../../t.const';

/**
 * #9026 regression — stitched, real-service integration.
 *
 * The unit specs verify each layer separately (validate-state mocks
 * RepairOperationService; repair-operation is tested in isolation). This test
 * drives the FULL background-sync repair path with BOTH services real —
 * `validateAndRepairCurrentState('sync', { callerHoldsLock: true })` →
 * real `validateAndRepair` (invalid state → real dataRepair) → real
 * `createRepairOperation` → real `_notifyUser` — and asserts the whole chain
 * never reaches a blocking native `confirm()`/`alert()` (which would hold the
 * sp_op_log lock during background sync), while still creating the REPAIR op
 * and surfacing the non-blocking "data repaired" snack.
 */
describe('#9026 background-sync repair is non-blocking (stitched)', () => {
  let service: ValidateStateService;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let confirmSpy: jasmine.Spy;
  let alertSpy: jasmine.Spy;
  let originalProduction: boolean;

  const createEmptyState = (): Record<string, unknown> => ({
    task: { ids: [], entities: {}, currentTaskId: null },
    project: { ids: [], entities: {} },
    tag: { ids: [], entities: {} },
    note: { ids: [], entities: {}, todayOrder: [] },
    section: { ids: [], entities: {} },
    simpleCounter: { ids: [], entities: {} },
    issueProvider: { ids: [], entities: {} },
    taskRepeatCfg: { ids: [], entities: {} },
    metric: initialMetricState,
    boards: { boardCfgs: [] },
    planner: plannerInitialState,
    menuTree: menuTreeInitialState,
    globalConfig: DEFAULT_GLOBAL_CONFIG,
    timeTracking: initialTimeTrackingState,
    reminders: [],
    pluginUserData: [],
    pluginMetadata: [],
    archiveYoung: {
      task: { ids: [], entities: {} },
      timeTracking: initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    },
    archiveOld: {
      task: { ids: [], entities: {} },
      timeTracking: initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    },
  });

  beforeEach(() => {
    const invalidState = createEmptyState();
    // Orphaned project reference in menuTree → cross-model validation fails,
    // dataRepair prunes it (a real, repairable inconsistency).
    invalidState.menuTree = {
      ...(invalidState.menuTree as MenuTreeState),
      projectTree: [{ id: 'ORPHAN_PROJECT', k: MenuTreeKind.PROJECT }],
    };

    const mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
      'getStateSnapshotForOperationLogAsync',
      'getStateSnapshotAsync',
    ]);
    mockStateSnapshotService.getStateSnapshot.and.returnValue(invalidState as never);
    mockStateSnapshotService.getStateSnapshotForOperationLogAsync.and.resolveTo(
      invalidState as never,
    );

    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'appendMixedSourceBatchSkipDuplicates',
      'saveStateCache',
    ]);
    mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.callFake(
      async (batches: readonly MixedSourceOperationBatch[]) => ({
        written: batches.flatMap((batch) =>
          batch.ops.map((op) => ({ seq: 1, op, source: batch.source })),
        ),
        skippedCount: 0,
      }),
    );
    mockOpLogStore.saveStateCache.and.resolveTo();

    const mockLockService = jasmine.createSpyObj('LockService', ['request']);
    mockLockService.request.and.callFake(
      async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
    );

    const mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockVectorClockService.getCurrentVectorClock.and.resolveTo({});

    const mockHydrationStateService = jasmine.createSpyObj('HydrationStateService', [
      'isApplyingRemoteOps',
      'startApplyingRemoteOps',
      'endApplyingRemoteOps',
      'startPostSyncCooldown',
    ]);
    mockHydrationStateService.isApplyingRemoteOps.and.returnValue(false);

    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);

    const mockTranslate = { instant: (k: string): string => k };
    const mockClientIdProvider = {
      loadClientId: jasmine.createSpy('loadClientId').and.resolveTo('test-client'),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        // ValidateStateService + RepairOperationService + RepairSyncContextService
        // are all providedIn: 'root' — left REAL so the chain is genuinely stitched.
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: LockService, useValue: mockLockService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: HydrationStateService, useValue: mockHydrationStateService },
        { provide: SnackService, useValue: mockSnackService },
        { provide: TranslateService, useValue: mockTranslate },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
      ],
    });
    service = TestBed.inject(ValidateStateService);

    // production=true → devError only logs (cannot pop a dialog), so any dialog
    // would have to come from the repair path itself — which is what we assert against.
    originalProduction = environment.production;
    (environment as unknown as { production: boolean }).production = true;
    spyOn(localStorage, 'setItem'); // don't touch the shared Karma localStorage

    confirmSpy = jasmine.isSpy(window.confirm)
      ? (window.confirm as jasmine.Spy)
      : spyOn(window, 'confirm');
    confirmSpy.and.returnValue(false);
    confirmSpy.calls.reset();
    alertSpy = jasmine.isSpy(window.alert)
      ? (window.alert as jasmine.Spy)
      : spyOn(window, 'alert');
    alertSpy.and.stub();
    alertSpy.calls.reset();
  });

  afterEach(() => {
    // Restore the shared module-global so this spec can't pollute others.
    (environment as unknown as { production: boolean }).production = originalProduction;
  });

  it('repairs a corrupt state under the lock without any blocking dialog, and snacks it', async () => {
    const isValid = await service.validateAndRepairCurrentState('sync', {
      callerHoldsLock: true,
    });

    // Repaired and reported valid.
    expect(isValid).toBeTrue();
    // No blocking native dialog anywhere on the path.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    // A REPAIR op was actually created (real createRepairOperation ran).
    expect(mockOpLogStore.appendMixedSourceBatchSkipDuplicates).toHaveBeenCalled();
    // ...and the non-blocking awareness snack was surfaced.
    expect(mockSnackService.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ msg: T.F.SYNC.D_DATA_REPAIRED.MSG }),
    );
  });
});
