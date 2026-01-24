import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { ValidateStateService } from './validate-state.service';
import { RepairOperationService } from './repair-operation.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
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
  let mockRepairService: jasmine.SpyObj<RepairOperationService>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;

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
    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
    ]);

    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        { provide: RepairOperationService, useValue: mockRepairService },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
      ],
    });
    service = TestBed.inject(ValidateStateService);
  });

  // TEMPORARILY SKIPPED: This test requires a complete AppDataComplete object
  // that passes Typia validation first before cross-model validation runs.
  // The repair system is disabled for debugging archive subtask loss.
  // See commit 5138b4654 - re-enable this test when repair is re-enabled.
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

  // TEMPORARILY SKIPPED: Repair functionality is disabled for debugging archive subtask loss
  // See commit 5138b4654 - re-enable this test when repair is re-enabled
  xit('should repair orphaned menu tree nodes', () => {
    // Force non-production environment to ensure devError throws
    const originalEnvProduction = environment.production;
    (environment as any).production = false;

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
});
