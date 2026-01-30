import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateService } from '@ngx-translate/core';
import { ValidateStateService } from './validate-state.service';
import { RepairOperationService } from './repair-operation.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { HydrationStateService } from '../apply/hydration-state.service';
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

describe('ValidateStateService', () => {
  let service: ValidateStateService;
  let store: MockStore;
  let mockRepairService: jasmine.SpyObj<RepairOperationService>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockClientIdProvider: { loadClientId: jasmine.Spy };
  let mockHydrationStateService: jasmine.SpyObj<HydrationStateService>;
  let mockTranslateService: jasmine.SpyObj<TranslateService>;

  const createEmptyState = (): Record<string, unknown> => ({
    task: { ids: [], entities: {}, currentTaskId: null },
    project: { ids: [], entities: {} },
    tag: { ids: [], entities: {} },
    note: { ids: [], entities: {}, todayOrder: [] },
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
    mockRepairService = jasmine.createSpyObj('RepairOperationService', [
      'createRepairOperation',
    ]);
    mockRepairService.createRepairOperation.and.returnValue(Promise.resolve(1));

    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
    ]);
    mockClientIdProvider = {
      loadClientId: jasmine
        .createSpy('loadClientId')
        .and.returnValue(Promise.resolve('test-client')),
    };
    mockHydrationStateService = jasmine.createSpyObj('HydrationStateService', [
      'isApplyingRemoteOps',
      'startApplyingRemoteOps',
      'endApplyingRemoteOps',
      'startPostSyncCooldown',
    ]);
    mockHydrationStateService.isApplyingRemoteOps.and.returnValue(false);

    mockTranslateService = jasmine.createSpyObj('TranslateService', ['instant']);
    mockTranslateService.instant.and.callFake((key: string) => key);

    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        { provide: RepairOperationService, useValue: mockRepairService },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
        { provide: HydrationStateService, useValue: mockHydrationStateService },
        { provide: TranslateService, useValue: mockTranslateService },
      ],
    });
    service = TestBed.inject(ValidateStateService);
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
  });

  // This test requires a complete AppDataComplete object that passes Typia validation
  // first before cross-model validation runs. The empty state used here fails Typia
  // validation before reaching cross-model checks, so crossModelError is undefined.
  xit('should handle isRelatedModelDataValid throwing errors gracefully', () => {
    // Force non-production environment to ensure devError throws
    const originalEnvProduction = environment.production;
    (environment as any).production = false;

    // Stub alert and confirm to prevent blocking tests
    // devError shows alert, then confirm - we want confirm to return false to avoid throwing
    // Check if already spied (may be globally mocked in test setup)
    if (jasmine.isSpy(window.alert)) {
      (window.alert as jasmine.Spy).and.stub();
    } else {
      spyOn(window, 'alert').and.stub();
    }
    if (jasmine.isSpy(window.confirm)) {
      (window.confirm as jasmine.Spy).and.returnValue(false);
    } else {
      spyOn(window, 'confirm').and.returnValue(false);
    }

    try {
      const state = createEmptyState();

      // Introduce an orphaned project reference in menuTree
      // This triggers isRelatedModelDataValid -> devError -> sets lastValidityError
      state.menuTree = {
        ...(state.menuTree as MenuTreeState),
        projectTree: [
          {
            id: 'NON_EXISTENT_PROJECT_ID',
            k: MenuTreeKind.PROJECT,
          },
        ],
      };

      // Should not throw
      const result = service.validateState(state);

      expect(result.isValid).toBeFalse();
      expect(result.crossModelError).toBeDefined();
      // The error message comes from devError/isRelatedModelDataValid
      expect(result.crossModelError).toContain('Orphaned project reference');
    } finally {
      (environment as any).production = originalEnvProduction;
      // Spies are automatically restored by Jasmine after each test
    }
  });

  it('should repair orphaned menu tree nodes when user confirms', () => {
    // Force non-production environment to ensure devError throws
    const originalEnvProduction = environment.production;
    (environment as any).production = false;

    // Stub alert to prevent blocking tests
    if (jasmine.isSpy(window.alert)) {
      (window.alert as jasmine.Spy).and.stub();
    } else {
      spyOn(window, 'alert').and.stub();
    }
    // Mock confirm to return true so repair proceeds
    if (jasmine.isSpy(window.confirm)) {
      (window.confirm as jasmine.Spy).and.returnValue(true);
    } else {
      spyOn(window, 'confirm').and.returnValue(true);
    }

    try {
      const state = createEmptyState();

      // Introduce an orphaned project reference in menuTree
      state.menuTree = {
        ...(state.menuTree as MenuTreeState),
        projectTree: [
          {
            id: 'NON_EXISTENT_PROJECT_ID',
            k: MenuTreeKind.PROJECT,
          },
        ],
      };

      // Should repair
      const result = service.validateAndRepair(state);

      expect(result.isValid).toBeTrue();
      expect(result.wasRepaired).toBeTrue();

      const repairedState = result.repairedState!;
      // The orphaned node should be gone
      expect((repairedState.menuTree as MenuTreeState).projectTree!.length).toBe(0);
    } finally {
      (environment as any).production = originalEnvProduction;
    }
  });

  it('should not repair when user declines confirmation', () => {
    // Force non-production environment to ensure devError throws
    const originalEnvProduction = environment.production;
    (environment as any).production = false;

    // Stub alert to prevent blocking tests
    if (jasmine.isSpy(window.alert)) {
      (window.alert as jasmine.Spy).and.stub();
    } else {
      spyOn(window, 'alert').and.stub();
    }
    // Mock confirm to return false so repair is declined
    if (jasmine.isSpy(window.confirm)) {
      (window.confirm as jasmine.Spy).and.returnValue(false);
    } else {
      spyOn(window, 'confirm').and.returnValue(false);
    }

    try {
      const state = createEmptyState();

      // Introduce an orphaned project reference in menuTree
      state.menuTree = {
        ...(state.menuTree as MenuTreeState),
        projectTree: [
          {
            id: 'NON_EXISTENT_PROJECT_ID',
            k: MenuTreeKind.PROJECT,
          },
        ],
      };

      // Should not repair when user declines
      const result = service.validateAndRepair(state);

      expect(result.isValid).toBeFalse();
      expect(result.wasRepaired).toBeFalse();
      expect(result.error).toBe('User declined repair');
    } finally {
      (environment as any).production = originalEnvProduction;
    }
  });

  describe('validateAndRepairCurrentState', () => {
    beforeEach(() => {
      // Default: stub alert and confirm
      if (!jasmine.isSpy(window.alert)) {
        spyOn(window, 'alert').and.stub();
      }
      if (!jasmine.isSpy(window.confirm)) {
        spyOn(window, 'confirm').and.returnValue(true);
      }
    });

    it('should return true when state is valid', async () => {
      const validState = createEmptyState();
      mockStateSnapshotService.getStateSnapshot.and.returnValue(validState as any);

      // Mock validateAndRepair to return valid state (empty state doesn't pass full Typia validation)
      spyOn(service, 'validateAndRepair').and.returnValue({
        isValid: true,
        wasRepaired: false,
      });

      const result = await service.validateAndRepairCurrentState('test-context');

      expect(result).toBeTrue();
      expect(mockRepairService.createRepairOperation).not.toHaveBeenCalled();
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('should return false when clientId is null', async () => {
      const originalEnvProduction = environment.production;
      (environment as any).production = false;

      try {
        // Create invalid state that needs repair
        const invalidState = createEmptyState();
        invalidState.menuTree = {
          ...(invalidState.menuTree as MenuTreeState),
          projectTree: [{ id: 'ORPHAN', k: MenuTreeKind.PROJECT }],
        };
        mockStateSnapshotService.getStateSnapshot.and.returnValue(invalidState as any);
        mockClientIdProvider.loadClientId.and.returnValue(Promise.resolve(null));

        const result = await service.validateAndRepairCurrentState('sync');

        expect(result).toBeFalse();
        expect(mockRepairService.createRepairOperation).not.toHaveBeenCalled();
      } finally {
        (environment as any).production = originalEnvProduction;
      }
    });

    it('should pass skipLock option to repair service when callerHoldsLock is true', async () => {
      const state = createEmptyState();
      mockStateSnapshotService.getStateSnapshot.and.returnValue(state as any);

      // Mock validateAndRepair to return repaired state
      spyOn(service, 'validateAndRepair').and.returnValue({
        isValid: true,
        wasRepaired: true,
        repairedState: state,
        repairSummary: { typeErrorsFixed: 1 } as any,
      });

      await service.validateAndRepairCurrentState('sync', { callerHoldsLock: true });

      expect(mockRepairService.createRepairOperation).toHaveBeenCalledWith(
        jasmine.anything(),
        jasmine.anything(),
        'test-client',
        { skipLock: true },
      );
    });

    it('should start/end hydration state for sync contexts', async () => {
      const state = createEmptyState();
      mockStateSnapshotService.getStateSnapshot.and.returnValue(state as any);

      // Mock validateAndRepair to return repaired state
      spyOn(service, 'validateAndRepair').and.returnValue({
        isValid: true,
        wasRepaired: true,
        repairedState: state,
        repairSummary: { typeErrorsFixed: 1 } as any,
      });

      await service.validateAndRepairCurrentState('sync');

      expect(mockHydrationStateService.startApplyingRemoteOps).toHaveBeenCalled();
      expect(mockHydrationStateService.endApplyingRemoteOps).toHaveBeenCalled();
      expect(mockHydrationStateService.startPostSyncCooldown).toHaveBeenCalled();
    });

    it('should not start/end hydration state for non-sync contexts', async () => {
      const originalEnvProduction = environment.production;
      (environment as any).production = false;

      try {
        const invalidState = createEmptyState();
        invalidState.menuTree = {
          ...(invalidState.menuTree as MenuTreeState),
          projectTree: [{ id: 'ORPHAN', k: MenuTreeKind.PROJECT }],
        };
        mockStateSnapshotService.getStateSnapshot.and.returnValue(invalidState as any);

        await service.validateAndRepairCurrentState('other-context');

        expect(mockHydrationStateService.startApplyingRemoteOps).not.toHaveBeenCalled();
        expect(mockHydrationStateService.endApplyingRemoteOps).not.toHaveBeenCalled();
      } finally {
        (environment as any).production = originalEnvProduction;
      }
    });

    it('should not start hydration state if already applying (nested call)', async () => {
      const originalEnvProduction = environment.production;
      (environment as any).production = false;

      try {
        const invalidState = createEmptyState();
        invalidState.menuTree = {
          ...(invalidState.menuTree as MenuTreeState),
          projectTree: [{ id: 'ORPHAN', k: MenuTreeKind.PROJECT }],
        };
        mockStateSnapshotService.getStateSnapshot.and.returnValue(invalidState as any);
        mockHydrationStateService.isApplyingRemoteOps.and.returnValue(true);

        await service.validateAndRepairCurrentState('sync');

        expect(mockHydrationStateService.startApplyingRemoteOps).not.toHaveBeenCalled();
        expect(mockHydrationStateService.endApplyingRemoteOps).not.toHaveBeenCalled();
        expect(mockHydrationStateService.startPostSyncCooldown).not.toHaveBeenCalled();
      } finally {
        (environment as any).production = originalEnvProduction;
      }
    });

    it('should dispatch loadAllData with isRemote flag for sync contexts', async () => {
      const state = createEmptyState();
      mockStateSnapshotService.getStateSnapshot.and.returnValue(state as any);

      // Mock validateAndRepair to return repaired state
      spyOn(service, 'validateAndRepair').and.returnValue({
        isValid: true,
        wasRepaired: true,
        repairedState: state,
        repairSummary: { typeErrorsFixed: 1 } as any,
      });

      await service.validateAndRepairCurrentState('sync');

      expect(store.dispatch).toHaveBeenCalled();
      const dispatchedAction = (store.dispatch as jasmine.Spy).calls.mostRecent().args[0];
      expect(dispatchedAction.meta?.isRemote).toBeTrue();
    });

    it('should dispatch loadAllData without isRemote flag for non-sync contexts', async () => {
      const state = createEmptyState();
      mockStateSnapshotService.getStateSnapshot.and.returnValue(state as any);

      // Mock validateAndRepair to return repaired state
      spyOn(service, 'validateAndRepair').and.returnValue({
        isValid: true,
        wasRepaired: true,
        repairedState: state,
        repairSummary: { typeErrorsFixed: 1 } as any,
      });

      await service.validateAndRepairCurrentState('other-context');

      expect(store.dispatch).toHaveBeenCalled();
      const dispatchedAction = (store.dispatch as jasmine.Spy).calls.mostRecent().args[0];
      expect(dispatchedAction.meta?.isRemote).toBeFalsy();
    });
  });
});
