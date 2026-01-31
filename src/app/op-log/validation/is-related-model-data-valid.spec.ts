import { AppDataComplete } from '../model/model-config';
import { PFLog } from '../../core/log';
import { TODAY_TAG } from '../../features/tag/tag.const';

describe('isRelatedModelDataValid', () => {
  let isRelatedModelDataValid: any;

  beforeEach(() => {
    // Suppress PFLog output during tests by spying on the methods
    spyOn(PFLog, 'log');
    spyOn(PFLog, 'info');
    spyOn(PFLog, 'error');
    spyOn(PFLog, 'warn');
    spyOn(PFLog, 'err');
    spyOn(PFLog, 'critical');
    /* eslint-disable @typescript-eslint/no-require-imports */
    // Reset modules to allow re-importing with mocks
    // @ts-ignore
    delete require.cache[require.resolve('../../util/dev-error')];
    // @ts-ignore
    delete require.cache[require.resolve('./is-related-model-data-valid')];

    // Mock the devError module
    // @ts-ignore
    require('../../util/dev-error');
    // @ts-ignore
    require.cache[require.resolve('../../util/dev-error')] = {
      exports: {
        devError: jasmine.createSpy('devError'),
      },
    };

    // Import the function under test
    // @ts-ignore
    isRelatedModelDataValid =
      require('./is-related-model-data-valid').isRelatedModelDataValid;
    /* eslint-enable @typescript-eslint/no-require-imports */
  });

  it('should handle null data gracefully', () => {
    // @ts-ignore
    const result = isRelatedModelDataValid(null);
    expect(result).toBe(false);
  });

  it('should handle partial null data gracefully', () => {
    const partialData: any = {
      project: { ids: [], entities: {} },
      tag: { ids: [], entities: {} },
      task: { ids: [], entities: {} },
      // Missing archiveYoung and archiveOld
      note: { ids: [], entities: {} },
      issueProvider: { ids: [], entities: {} },
      reminders: [],
    };

    const result = isRelatedModelDataValid(partialData as AppDataComplete);
    expect(result).toBe(false);
  });

  it('should fail validation when task has non-existent repeatCfgId', () => {
    const dataWithOrphanedRepeatCfgId: any = {
      project: {
        ids: ['p1'],
        entities: {
          p1: { id: 'p1', taskIds: ['t1'], backlogTaskIds: [], noteIds: [] },
        },
      },
      tag: { ids: [], entities: {} },
      task: {
        ids: ['t1'],
        entities: {
          t1: {
            id: 't1',
            projectId: 'p1',
            tagIds: [],
            subTaskIds: [],
            repeatCfgId: 'NON_EXISTENT_CFG',
          },
        },
      },
      taskRepeatCfg: { ids: [], entities: {} },
      archiveYoung: { task: { ids: [], entities: {} } },
      archiveOld: { task: { ids: [], entities: {} } },
      note: { ids: [], entities: {}, todayOrder: [] },
      issueProvider: { ids: [], entities: {} },
      reminders: [],
      menuTree: { projectTree: [], tagTree: [] },
    };

    const result = isRelatedModelDataValid(dataWithOrphanedRepeatCfgId);
    expect(result).toBe(false);
  });

  it('should pass validation when task has valid repeatCfgId', () => {
    const dataWithValidRepeatCfgId: any = {
      project: {
        ids: ['p1'],
        entities: {
          p1: { id: 'p1', taskIds: ['t1'], backlogTaskIds: [], noteIds: [] },
        },
      },
      tag: { ids: [], entities: {} },
      task: {
        ids: ['t1'],
        entities: {
          t1: {
            id: 't1',
            projectId: 'p1',
            tagIds: [],
            subTaskIds: [],
            repeatCfgId: 'validRepeatCfg',
          },
        },
      },
      taskRepeatCfg: {
        ids: ['validRepeatCfg'],
        entities: { validRepeatCfg: { id: 'validRepeatCfg' } },
      },
      archiveYoung: { task: { ids: [], entities: {} } },
      archiveOld: { task: { ids: [], entities: {} } },
      note: { ids: [], entities: {}, todayOrder: [] },
      issueProvider: { ids: [], entities: {} },
      reminders: [],
      menuTree: { projectTree: [], tagTree: [] },
    };

    const result = isRelatedModelDataValid(dataWithValidRepeatCfgId);
    expect(result).toBe(true);
  });

  describe('TODAY_TAG orphaned IDs handling', () => {
    it('should pass validation for TODAY_TAG with orphaned task IDs and log warning', () => {
      const dataWithTodayTagOrphans: any = {
        project: { ids: [], entities: {} },
        tag: {
          ids: [TODAY_TAG.id],
          entities: {
            [TODAY_TAG.id]: {
              id: TODAY_TAG.id,
              title: TODAY_TAG.title,
              taskIds: ['orphan-task-1', 'orphan-task-2'], // These tasks don't exist
            },
          },
        },
        task: { ids: [], entities: {} }, // No tasks
        taskRepeatCfg: { ids: [], entities: {} },
        archiveYoung: { task: { ids: [], entities: {} } },
        archiveOld: { task: { ids: [], entities: {} } },
        note: { ids: [], entities: {}, todayOrder: [] },
        issueProvider: { ids: [], entities: {} },
        reminders: [],
        menuTree: { projectTree: [], tagTree: [] },
      };

      const result = isRelatedModelDataValid(dataWithTodayTagOrphans);

      // Should pass because TODAY_TAG orphans are harmless (virtual tag)
      expect(result).toBe(true);
      // Verify warning was logged
      expect(PFLog.info).toHaveBeenCalledWith(
        jasmine.stringContaining('TODAY_TAG has 2 orphaned task IDs (harmless)'),
        jasmine.any(Object),
      );
      // Validation should NOT mutate the data (read-only)
      expect(dataWithTodayTagOrphans.tag.entities[TODAY_TAG.id].taskIds).toEqual([
        'orphan-task-1',
        'orphan-task-2',
      ]);
    });

    it('should pass validation for TODAY_TAG with mixed valid and orphaned task IDs', () => {
      const dataWithMixedTodayTag: any = {
        project: { ids: [], entities: {} },
        tag: {
          ids: [TODAY_TAG.id, 'regularTag'],
          entities: {
            [TODAY_TAG.id]: {
              id: TODAY_TAG.id,
              title: TODAY_TAG.title,
              taskIds: ['validTask', 'orphanTask'], // Mixed valid and orphan
            },
            regularTag: {
              id: 'regularTag',
              title: 'Regular Tag',
              taskIds: ['validTask'],
            },
          },
        },
        task: {
          ids: ['validTask'],
          entities: {
            validTask: {
              id: 'validTask',
              projectId: null,
              tagIds: ['regularTag'],
              subTaskIds: [],
              parentId: null,
            },
          },
        },
        taskRepeatCfg: { ids: [], entities: {} },
        archiveYoung: { task: { ids: [], entities: {} } },
        archiveOld: { task: { ids: [], entities: {} } },
        note: { ids: [], entities: {}, todayOrder: [] },
        issueProvider: { ids: [], entities: {} },
        reminders: [],
        menuTree: { projectTree: [], tagTree: [] },
      };

      const result = isRelatedModelDataValid(dataWithMixedTodayTag);

      expect(result).toBe(true);
      // Validation should NOT mutate the data (read-only)
      expect(dataWithMixedTodayTag.tag.entities[TODAY_TAG.id].taskIds).toEqual([
        'validTask',
        'orphanTask',
      ]);
    });

    it('should fail validation for regular tags with orphaned task IDs', () => {
      const dataWithRegularTagOrphans: any = {
        project: { ids: [], entities: {} },
        tag: {
          ids: ['regularTag'],
          entities: {
            regularTag: {
              id: 'regularTag',
              title: 'Regular Tag',
              taskIds: ['orphanTask'], // This task doesn't exist
            },
          },
        },
        task: { ids: [], entities: {} }, // No tasks
        taskRepeatCfg: { ids: [], entities: {} },
        archiveYoung: { task: { ids: [], entities: {} } },
        archiveOld: { task: { ids: [], entities: {} } },
        note: { ids: [], entities: {}, todayOrder: [] },
        issueProvider: { ids: [], entities: {} },
        reminders: [],
        menuTree: { projectTree: [], tagTree: [] },
      };

      const result = isRelatedModelDataValid(dataWithRegularTagOrphans);

      // Should fail because regular tags don't get self-healing
      expect(result).toBe(false);
    });

    it('should not log warning when TODAY_TAG has no orphaned IDs', () => {
      const dataWithValidTodayTag: any = {
        project: {
          ids: ['p1'],
          entities: {
            p1: { id: 'p1', taskIds: ['validTask'], backlogTaskIds: [], noteIds: [] },
          },
        },
        tag: {
          ids: [TODAY_TAG.id],
          entities: {
            [TODAY_TAG.id]: {
              id: TODAY_TAG.id,
              title: TODAY_TAG.title,
              taskIds: ['validTask'],
            },
          },
        },
        task: {
          ids: ['validTask'],
          entities: {
            validTask: {
              id: 'validTask',
              projectId: 'p1',
              tagIds: [],
              subTaskIds: [],
              parentId: null,
            },
          },
        },
        taskRepeatCfg: { ids: [], entities: {} },
        archiveYoung: { task: { ids: [], entities: {} } },
        archiveOld: { task: { ids: [], entities: {} } },
        note: { ids: [], entities: {}, todayOrder: [] },
        issueProvider: { ids: [], entities: {} },
        reminders: [],
        menuTree: { projectTree: [], tagTree: [] },
      };

      const result = isRelatedModelDataValid(dataWithValidTodayTag);

      expect(result).toBe(true);
      // Should not log any self-healing warning
      expect(PFLog.warn).not.toHaveBeenCalled();
    });
  });
});
