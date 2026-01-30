import { isLegacyBackupData, migrateLegacyBackup } from './migrate-legacy-backup';
import { INBOX_PROJECT } from '../../features/project/project.const';

/**
 * Creates a minimal v10-era legacy backup structure.
 * This matches the shape of backups exported by Super Productivity v10-v13.
 */
const createLegacyBackup = (overrides: Record<string, any> = {}): Record<string, any> => ({
  bookmark: {},
  globalConfig: {
    __modelVersion: 3.4,
    misc: { defaultProjectId: null },
    lang: { lng: 'en' },
  },
  reminders: [],
  planner: { days: {} },
  project: {
    ids: ['proj-1'],
    entities: {
      'proj-1': {
        id: 'proj-1',
        title: 'My Project',
        taskIds: ['task-1'],
        backlogTaskIds: [],
        noteIds: [],
        isHiddenFromMenu: false,
        isArchived: false,
        workStart: { '2024-01-01': 1704067200000 },
        workEnd: { '2024-01-01': 1704096000000 },
        breakNr: {},
        breakTime: {},
      },
    },
    __modelVersion: 6.14,
  },
  tag: {
    ids: ['TODAY'],
    entities: {
      TODAY: { id: 'TODAY', title: 'Today', taskIds: [], icon: 'wb_sunny' },
    },
    __modelVersion: 1,
  },
  simpleCounter: { ids: [], entities: {}, __modelVersion: 2 },
  note: { ids: [], entities: {}, todayOrder: [], __modelVersion: 1 },
  metric: { ids: [], entities: {}, __modelVersion: 1 },
  improvement: { ids: [], entities: {}, hiddenImprovementBannerItems: [] },
  obstruction: { ids: [], entities: {} },
  task: {
    ids: ['task-1'],
    entities: {
      'task-1': {
        id: 'task-1',
        projectId: 'proj-1',
        title: 'Active Task',
        subTaskIds: [],
        timeSpentOnDay: { '2024-01-01': 3600000 },
        timeSpent: 3600000,
        timeEstimate: 7200000,
        isDone: false,
        notes: '',
        tagIds: [],
        created: 1704067200000,
        attachments: [],
      },
    },
    currentTaskId: null,
    selectedTaskId: null,
    __modelVersion: 3.6,
  },
  taskArchive: {
    ids: ['archived-1', 'archived-2'],
    entities: {
      'archived-1': {
        id: 'archived-1',
        projectId: 'proj-1',
        title: 'Archived Task 1',
        subTaskIds: [],
        timeSpentOnDay: {},
        timeSpent: 0,
        timeEstimate: 0,
        isDone: true,
        doneOn: 1704067200000,
        notes: '',
        tagIds: [],
        created: 1704000000000,
        attachments: [],
      },
      'archived-2': {
        id: 'archived-2',
        projectId: 'proj-1',
        title: 'Archived Task 2',
        subTaskIds: [],
        timeSpentOnDay: {},
        timeSpent: 0,
        timeEstimate: 0,
        isDone: true,
        doneOn: 1704067200000,
        notes: '',
        tagIds: [],
        created: 1704000000000,
        attachments: [],
      },
    },
    __modelVersion: 3.6,
  },
  taskRepeatCfg: { ids: [], entities: {}, __modelVersion: 1.43 },
  lastLocalSyncModelChange: 1704096000000,
  lastArchiveUpdate: 1704096000000,
  ...overrides,
});

/**
 * Creates a minimal modern v17-era backup.
 */
const createModernBackup = (): Record<string, any> => ({
  task: { ids: [], entities: {}, currentTaskId: null, selectedTaskId: null },
  project: {
    ids: [INBOX_PROJECT.id],
    entities: { [INBOX_PROJECT.id]: { ...INBOX_PROJECT } },
  },
  tag: {
    ids: ['TODAY'],
    entities: { TODAY: { id: 'TODAY', title: 'Today', taskIds: [], icon: 'wb_sunny' } },
  },
  globalConfig: { misc: { isDisableInitialDialog: true }, sync: { isEnabled: false } },
  note: { ids: [], entities: {}, todayOrder: [] },
  simpleCounter: { ids: [], entities: {} },
  taskRepeatCfg: { ids: [], entities: {} },
  metric: { ids: [], entities: {} },
  planner: { days: {} },
  issueProvider: { ids: [], entities: {} },
  boards: { boardCfgs: [] },
  menuTree: { tagTree: [], projectTree: [] },
  timeTracking: { project: {}, tag: {} },
  reminders: [],
  pluginMetadata: [],
  pluginUserData: [],
  archiveYoung: {
    task: { ids: [], entities: {} },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush: 0,
  },
  archiveOld: {
    task: { ids: [], entities: {} },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush: 0,
  },
});

const V17_REQUIRED_KEYS = [
  'project',
  'menuTree',
  'globalConfig',
  'planner',
  'boards',
  'note',
  'issueProvider',
  'metric',
  'task',
  'tag',
  'simpleCounter',
  'taskRepeatCfg',
  'reminders',
  'timeTracking',
  'pluginUserData',
  'pluginMetadata',
  'archiveYoung',
  'archiveOld',
];

const LEGACY_KEYS = [
  'bookmark',
  'improvement',
  'obstruction',
  'taskArchive',
  'lastLocalSyncModelChange',
  'lastArchiveUpdate',
];

describe('migrate-legacy-backup', () => {
  describe('isLegacyBackupData', () => {
    it('should detect v10-era backup with taskArchive', () => {
      const data = createLegacyBackup();
      expect(isLegacyBackupData(data)).toBe(true);
    });

    it('should detect backup with improvement key (removed in v17)', () => {
      const data = { improvement: { ids: [], entities: {} }, task: {}, project: {} };
      expect(isLegacyBackupData(data)).toBe(true);
    });

    it('should detect backup with obstruction key (removed in v17)', () => {
      const data = { obstruction: { ids: [], entities: {} }, task: {}, project: {} };
      expect(isLegacyBackupData(data)).toBe(true);
    });

    it('should NOT detect modern v17 backup as legacy', () => {
      const data = createModernBackup();
      expect(isLegacyBackupData(data)).toBe(false);
    });

    it('should NOT detect minimal v17 data without archives as legacy', () => {
      // dataRepair handles missing archives; no migration needed
      const data = { task: { ids: [], entities: {} }, project: { ids: [], entities: {} } };
      expect(isLegacyBackupData(data)).toBe(false);
    });
  });

  describe('migrateLegacyBackup', () => {
    it('should produce all v17-required keys', () => {
      const data = createLegacyBackup();
      const result = migrateLegacyBackup(data) as unknown as Record<string, any>;

      for (const key of V17_REQUIRED_KEYS) {
        expect(key in result).toBe(true);
      }
    });

    it('should strip all legacy keys', () => {
      const data = createLegacyBackup();
      const result = migrateLegacyBackup(data) as unknown as Record<string, any>;

      for (const key of LEGACY_KEYS) {
        expect(key in result).toBe(false);
      }
    });

    it('should migrate flat taskArchive into archiveYoung', () => {
      const data = createLegacyBackup();
      const result = migrateLegacyBackup(data) as any;

      expect(result.archiveYoung).toBeDefined();
      expect(result.archiveYoung.task.ids).toContain('archived-1');
      expect(result.archiveYoung.task.ids).toContain('archived-2');
      expect(result.archiveYoung.task.ids.length).toBe(2);
    });

    it('should set archiveOld to empty', () => {
      const data = createLegacyBackup();
      const result = migrateLegacyBackup(data) as any;

      expect(result.archiveOld).toBeDefined();
      expect(result.archiveOld.task.ids.length).toBe(0);
    });

    it('should preserve active task count', () => {
      const data = createLegacyBackup();
      const result = migrateLegacyBackup(data) as any;

      expect(result.task.ids.length).toBe(data.task.ids.length);
      expect(result.task.entities['task-1']).toBeDefined();
    });

    it('should preserve project count (adding INBOX if needed)', () => {
      const data = createLegacyBackup();
      const result = migrateLegacyBackup(data) as any;

      // Original project plus INBOX
      expect(result.project.ids).toContain('proj-1');
      expect(result.project.ids).toContain(INBOX_PROJECT.id);
    });

    it('should extract time tracking from projects', () => {
      const data = createLegacyBackup();
      const result = migrateLegacyBackup(data) as any;

      expect(result.timeTracking).toBeDefined();
      expect(result.timeTracking.project['proj-1']).toBeDefined();
      expect(result.timeTracking.project['proj-1']['2024-01-01'].s).toBe(1704067200000);
      expect(result.timeTracking.project['proj-1']['2024-01-01'].e).toBe(1704096000000);
    });

    it('should remove workStart/workEnd from project entities', () => {
      const data = createLegacyBackup();
      const result = migrateLegacyBackup(data) as any;

      const project = result.project.entities['proj-1'];
      expect(project.workStart).toBeUndefined();
      expect(project.workEnd).toBeUndefined();
      expect(project.breakNr).toBeUndefined();
      expect(project.breakTime).toBeUndefined();
    });

    it('should initialize menuTree', () => {
      const data = createLegacyBackup();
      const result = migrateLegacyBackup(data) as any;

      expect(result.menuTree).toBeDefined();
      expect(Array.isArray(result.menuTree.projectTree)).toBe(true);
      expect(Array.isArray(result.menuTree.tagTree)).toBe(true);
    });

    it('should initialize boards', () => {
      const data = createLegacyBackup();
      const result = migrateLegacyBackup(data) as any;

      expect(result.boards).toBeDefined();
      expect(Array.isArray(result.boards.boardCfgs)).toBe(true);
    });

    it('should initialize issueProvider', () => {
      const data = createLegacyBackup();
      const result = migrateLegacyBackup(data) as any;

      expect(result.issueProvider).toBeDefined();
      expect(Array.isArray(result.issueProvider.ids)).toBe(true);
    });

    it('should initialize pluginUserData and pluginMetadata', () => {
      const data = createLegacyBackup();
      const result = migrateLegacyBackup(data) as any;

      expect(result.pluginUserData).toBeDefined();
      expect(result.pluginMetadata).toBeDefined();
    });

    it('should migrate lang to localization and lowercase', () => {
      const data = createLegacyBackup({
        globalConfig: {
          __modelVersion: 3.4,
          misc: {},
          lang: { lng: 'EN' },
        },
      });
      const result = migrateLegacyBackup(data) as any;

      expect(result.globalConfig.localization).toBeDefined();
      expect(result.globalConfig.localization.lng).toBe('en');
      expect(result.globalConfig.lang).toBeUndefined();
    });

    it('should convert plannedAt to dueWithTime on tasks', () => {
      const data = createLegacyBackup();
      data.task.entities['task-1'].plannedAt = 1704110400000;
      const result = migrateLegacyBackup(data) as any;

      const task = result.task.entities['task-1'];
      expect(task.dueWithTime).toBe(1704110400000);
      expect(task.plannedAt).toBeUndefined();
    });

    it('should be idempotent when run on already-migrated data shape', () => {
      const data = createLegacyBackup();
      const result1 = migrateLegacyBackup(data) as any;

      // Add back the markers so it runs again
      const secondInput = { ...result1, taskArchive: { ids: [], entities: {} } };
      const result2 = migrateLegacyBackup(secondInput) as any;

      // Should still have all required keys and correct counts
      for (const key of V17_REQUIRED_KEYS) {
        expect(key in result2).toBe(true);
      }
      expect(result2.task.ids.length).toBe(result1.task.ids.length);
    });

    it('should handle backup with no tasks gracefully', () => {
      const data = createLegacyBackup({
        task: { ids: [], entities: {}, currentTaskId: null, __modelVersion: 3.6 },
        taskArchive: { ids: [], entities: {}, __modelVersion: 3.6 },
        project: {
          ids: ['proj-1'],
          entities: {
            'proj-1': {
              id: 'proj-1',
              title: 'Empty Project',
              taskIds: [],
              backlogTaskIds: [],
              noteIds: [],
            },
          },
        },
      });

      const result = migrateLegacyBackup(data) as any;

      expect(result.task.ids.length).toBe(0);
      expect(result.archiveYoung.task.ids.length).toBe(0);
      expect(result.archiveOld.task.ids.length).toBe(0);
    });
  });
});
