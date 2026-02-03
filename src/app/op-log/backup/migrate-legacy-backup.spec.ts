/* eslint-disable @typescript-eslint/naming-convention */
import { isLegacyBackupData, migrateLegacyBackup } from './migrate-legacy-backup';
import { INBOX_PROJECT } from '../../features/project/project.const';
import fixture from './test-fixtures/legacy-v10-backup.json';

/**
 * Creates a minimal v10-era legacy backup structure.
 * This matches the shape of backups exported by Super Productivity v10-v13.
 */
const createLegacyBackup = (
  overrides: Record<string, any> = {},
): Record<string, any> => ({
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
      const data = {
        task: { ids: [], entities: {} },
        project: { ids: [], entities: {} },
      };
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

    it('should NOT overwrite archiveYoung for v13-v15 data with empty timeTracking', () => {
      // Simulates a v13-v15 backup: already has archiveYoung/archiveOld (migration 2 ran),
      // has improvement (v13-v15 marker), but timeTracking.project is empty (no work tracked).
      // Migration 2 must skip and preserve existing archiveYoung.
      const data = createLegacyBackup({
        // Remove v10 markers
        taskArchive: undefined,
        bookmark: undefined,
        // Add v13+ shape: archives already split
        archiveYoung: {
          task: {
            ids: ['arch-1'],
            entities: {
              'arch-1': {
                id: 'arch-1',
                projectId: 'proj-1',
                title: 'Archived from v13',
                subTaskIds: [],
                timeSpentOnDay: {},
                timeSpent: 0,
                timeEstimate: 0,
                isDone: true,
                tagIds: [],
                created: 1704000000000,
                attachments: [],
              },
            },
          },
          timeTracking: { project: {}, tag: {} },
          lastTimeTrackingFlush: 0,
        },
        archiveOld: {
          task: { ids: [], entities: {} },
          timeTracking: { project: {}, tag: {} },
          lastTimeTrackingFlush: 0,
        },
        // Empty time tracking (the edge case trigger)
        timeTracking: { project: {}, tag: {} },
        // Still has improvement (v13-v15 detection marker)
        improvement: { ids: [], entities: {}, hiddenImprovementBannerItems: [] },
      });

      // Remove workStart/workEnd from project (already extracted in v13)
      delete data.project.entities['proj-1'].workStart;
      delete data.project.entities['proj-1'].workEnd;

      const result = migrateLegacyBackup(data) as any;

      // archiveYoung must be preserved, NOT overwritten with empty
      expect(result.archiveYoung.task.ids).toContain('arch-1');
      expect(result.archiveYoung.task.ids.length).toBe(1);
      expect(result.archiveYoung.task.entities['arch-1'].title).toBe('Archived from v13');
    });

    it('should NOT overwrite archiveYoung for v13-v15 data even with no archived tasks', () => {
      // Same as above but archiveYoung has no tasks (empty but present).
      // Migration 2 must still skip — presence of archiveYoung + archiveOld + timeTracking
      // without taskArchive means migration 2 already ran.
      const data = createLegacyBackup({
        taskArchive: undefined,
        bookmark: undefined,
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
        timeTracking: { project: {}, tag: {} },
        improvement: { ids: [], entities: {}, hiddenImprovementBannerItems: [] },
      });

      delete data.project.entities['proj-1'].workStart;
      delete data.project.entities['proj-1'].workEnd;

      const result = migrateLegacyBackup(data) as any;

      // Should still have empty archives (not re-created from nonexistent taskArchive)
      expect(result.archiveYoung.task.ids.length).toBe(0);
      expect(result.archiveOld.task.ids.length).toBe(0);
    });

    it('should preserve issueAttachmentNr of 0 (not coerce to undefined)', () => {
      const data = createLegacyBackup();
      data.task.entities['task-1'].issueAttachmentNr = 0;
      const result = migrateLegacyBackup(data) as any;

      expect(result.task.entities['task-1'].issueAttachmentNr).toBe(0);
    });

    it('should preserve issuePoints of 0 (not coerce to undefined)', () => {
      const data = createLegacyBackup();
      data.task.entities['task-1'].issuePoints = 0;
      const result = migrateLegacyBackup(data) as any;

      expect(result.task.entities['task-1'].issuePoints).toBe(0);
    });

    it('should normalize null issueAttachmentNr and issuePoints to undefined', () => {
      const data = createLegacyBackup();
      data.task.entities['task-1'].issueAttachmentNr = null;
      data.task.entities['task-1'].issuePoints = null;
      const result = migrateLegacyBackup(data) as any;

      expect(result.task.entities['task-1'].issueAttachmentNr).toBeUndefined();
      expect(result.task.entities['task-1'].issuePoints).toBeUndefined();
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

  describe('migrateLegacyBackup with fixture file', () => {
    it('should detect fixture as legacy', () => {
      expect(isLegacyBackupData(fixture)).toBe(true);
    });

    it('should produce all v17-required keys from fixture', () => {
      const result = migrateLegacyBackup(structuredClone(fixture)) as unknown as Record<
        string,
        any
      >;

      for (const key of V17_REQUIRED_KEYS) {
        expect(key in result)
          .withContext(`expected key "${key}" to be present`)
          .toBe(true);
      }
    });

    it('should strip all legacy keys from fixture', () => {
      const result = migrateLegacyBackup(structuredClone(fixture)) as unknown as Record<
        string,
        any
      >;

      for (const key of LEGACY_KEYS) {
        expect(key in result)
          .withContext(`expected key "${key}" to be absent`)
          .toBe(false);
      }
    });

    it('should preserve active tasks from fixture', () => {
      const result = migrateLegacyBackup(structuredClone(fixture)) as any;

      // fixture has task-1, task-2, task-2-sub, task-3
      expect(result.task.ids.length).toBe(fixture.task.ids.length);
    });

    it('should migrate archived tasks from fixture into archiveYoung', () => {
      const result = migrateLegacyBackup(structuredClone(fixture)) as any;

      // fixture.taskArchive has arch-1, arch-2
      expect(result.archiveYoung.task.ids).toContain('arch-1');
      expect(result.archiveYoung.task.ids).toContain('arch-2');
      expect(result.archiveYoung.task.ids.length).toBe(fixture.taskArchive.ids.length);
    });

    it('should extract time tracking from fixture projects', () => {
      const result = migrateLegacyBackup(structuredClone(fixture)) as any;

      expect(result.timeTracking.project['proj-1']).toBeDefined();
      expect(result.timeTracking.project['proj-1']['2024-01-15'].s).toBe(1705312800000);
      expect(result.timeTracking.project['proj-1']['2024-01-15'].e).toBe(1705341600000);
      expect(result.timeTracking.project['proj-1']['2024-01-15'].b).toBe(2);
      expect(result.timeTracking.project['proj-1']['2024-01-15'].bt).toBe(1800000);
    });

    it('should convert plannedAt to dueWithTime from fixture', () => {
      const result = migrateLegacyBackup(structuredClone(fixture)) as any;

      expect(result.task.entities['task-1'].dueWithTime).toBe(1705399200000);
      expect(result.task.entities['task-1'].plannedAt).toBeUndefined();
    });

    it('should convert numeric issueId to string from fixture', () => {
      const result = migrateLegacyBackup(structuredClone(fixture)) as any;

      expect(result.task.entities['task-3'].issueId).toBe('42');
    });

    it('should convert _showSubTasksMode to _hideSubTasksMode from fixture', () => {
      const result = migrateLegacyBackup(structuredClone(fixture)) as any;

      // _showSubTasksMode: 0 → _hideSubTasksMode: 2
      expect(result.task.entities['task-2']._hideSubTasksMode).toBe(2);
      expect(result.task.entities['task-2']._showSubTasksMode).toBeUndefined();
    });

    it('should normalize null timeEstimate and created from fixture', () => {
      const result = migrateLegacyBackup(structuredClone(fixture)) as any;

      // task-2-sub had timeEstimate: null and created: null
      expect(result.task.entities['task-2-sub'].timeEstimate).toBe(0);
      expect(result.task.entities['task-2-sub'].created).toBe(0);
    });

    it('should remove TODAY_TAG from repeat config tagIds in fixture', () => {
      const result = migrateLegacyBackup(structuredClone(fixture)) as any;

      expect(result.taskRepeatCfg.entities['repeat-1'].tagIds).not.toContain('TODAY');
    });

    it('should add lastTaskCreationDay for repeat configs in fixture', () => {
      const result = migrateLegacyBackup(structuredClone(fixture)) as any;

      const cfg = result.taskRepeatCfg.entities['repeat-1'];
      expect(cfg.lastTaskCreation).toBeDefined();
      expect(cfg.lastTaskCreationDay).toBeDefined();
    });

    it('should migrate lang to localization from fixture', () => {
      const result = migrateLegacyBackup(structuredClone(fixture)) as any;

      expect(result.globalConfig.localization).toBeDefined();
      expect(result.globalConfig.localization.lng).toBe('en');
      expect(result.globalConfig.lang).toBeUndefined();
    });
  });
});
