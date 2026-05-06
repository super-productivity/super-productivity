import { createAppDataCompleteMock } from '../../util/app-data-mock';
import { dataRepair } from './data-repair';
import { fakeEntityStateFromArray } from '../../util/fake-entity-state-from-array';
import { DEFAULT_TASK, Task, TaskArchive } from '../../features/tasks/task.model';
import { createEmptyEntity } from '../../util/create-empty-entity';
import { Tag, TagState } from '../../features/tag/tag.model';
import { Project, ProjectState } from '../../features/project/project.model';
import { DEFAULT_PROJECT, INBOX_PROJECT } from '../../features/project/project.const';
import { DEFAULT_TAG, TODAY_TAG } from '../../features/tag/tag.const';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
} from '../../features/task-repeat-cfg/task-repeat-cfg.model';
import { IssueProvider } from '../../features/issue/issue.model';
import { AppDataComplete } from '../model/model-config';
import { dirtyDeepCopy } from '../../util/dirtyDeepCopy';

const FAKE_PROJECT_ID = 'FAKE_PROJECT_ID';
describe('dataRepair()', () => {
  let mock: AppDataComplete;
  beforeEach(() => {
    mock = createAppDataCompleteMock();
    mock.project = {
      ...fakeEntityStateFromArray([
        INBOX_PROJECT,
        {
          title: 'FAKE_PROJECT',
          id: FAKE_PROJECT_ID,
          taskIds: [],
          backlogTaskIds: [],
          noteIds: [],
        },
      ] as Partial<Project>[]),
    };

    mock.tag = {
      ...fakeEntityStateFromArray([
        {
          ...TODAY_TAG,
        },
      ] as Partial<Tag>[]),
    };
    // to prevent side effects
    mock = dirtyDeepCopy(mock);
  });

  it('should delete tasks with same id in "task" and "taskArchive" from taskArchive', () => {
    const taskState = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'TEST',
          title: 'TEST',
          projectId: FAKE_PROJECT_ID,
        },
      ]),
    } as any;

    const result = dataRepair({
      ...mock,
      task: taskState,
      archiveYoung: {
        lastTimeTrackingFlush: 0,
        timeTracking: mock.archiveYoung.timeTracking,
        task: fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 'TEST',
            title: 'TEST',
            projectId: FAKE_PROJECT_ID,
          },
        ]),
      },
    } as any);

    expect(result.data.task).toEqual(taskState);
    expect(result.data.archiveYoung.lastTimeTrackingFlush).toBe(0);
    expect(result.data.archiveYoung.timeTracking).toBe(mock.archiveYoung.timeTracking);
    expect(result.data.archiveYoung.task.ids).toEqual([]);
    expect(Object.keys(result.data.archiveYoung.task.entities)).toEqual([]);
  });

  it('should delete missing tasks for tags today list', () => {
    const taskState = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'TEST',
          title: 'TEST',
          projectId: FAKE_PROJECT_ID,
        },
      ]),
    } as any;

    const tagState: TagState = {
      ...fakeEntityStateFromArray([
        {
          title: 'TEST_TAG',
          id: 'TEST_ID_TAG',
          taskIds: ['goneTag', 'TEST', 'noneExisting'],
        },
      ] as Partial<Tag>[]),
    };

    expect(
      dataRepair({
        ...mock,
        tag: tagState,
        task: taskState,
      }).data,
    ).toEqual({
      ...mock,
      task: taskState as any,
      tag: {
        ...tagState,
        entities: {
          TEST_ID_TAG: {
            title: 'TEST_TAG',
            id: 'TEST_ID_TAG',
            taskIds: ['TEST'],
          },
        } as any,
      },
    });
  });

  it('should delete missing tasks for projects today list', () => {
    const taskState = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'TEST',
          title: 'TEST',
          projectId: 'TEST_ID_PROJECT',
        },
      ]),
    } as any;

    const projectState: ProjectState = {
      ...fakeEntityStateFromArray([
        INBOX_PROJECT,
        {
          title: 'TEST_PROJECT',
          id: 'TEST_ID_PROJECT',
          taskIds: ['goneProject', 'TEST', 'noneExisting'],
          backlogTaskIds: [],
          noteIds: [],
        },
      ] as Partial<Project>[]),
    };

    expect(
      dataRepair({
        ...mock,
        project: projectState,
        task: taskState,
      }).data,
    ).toEqual({
      ...mock,
      task: taskState as any,
      project: {
        ...projectState,
        entities: {
          INBOX_PROJECT,
          TEST_ID_PROJECT: {
            title: 'TEST_PROJECT',
            id: 'TEST_ID_PROJECT',
            taskIds: ['TEST'],
            backlogTaskIds: [],
            noteIds: [],
          },
        } as any,
      },
    });
  });

  it('should remove tasks with missing data from the project lists', () => {
    const taskState = {
      ...mock.task,
      ids: ['EXISTING'],
      entities: {
        EXISTING: { ...DEFAULT_TASK, id: 'EXISTING', projectId: 'TEST_ID_PROJECT' },
      },
    } as any;

    const projectState: ProjectState = {
      ...fakeEntityStateFromArray([
        {
          title: 'TEST_PROJECT',
          id: 'TEST_ID_PROJECT',
          taskIds: ['EXISTING', 'goneProject', 'TEST', 'noneExisting'],
          backlogTaskIds: ['noneExistingBacklog', 'nullBacklog'],
          noteIds: [],
        },
        INBOX_PROJECT,
      ] as Partial<Project>[]),
    };

    expect(
      dataRepair({
        ...mock,
        project: projectState,
        task: taskState,
      }).data,
    ).toEqual({
      ...mock,
      task: taskState as any,
      project: {
        ...projectState,
        entities: {
          TEST_ID_PROJECT: {
            title: 'TEST_PROJECT',
            id: 'TEST_ID_PROJECT',
            taskIds: ['EXISTING'],
            backlogTaskIds: [],
            noteIds: [],
          },
          INBOX_PROJECT,
        } as any,
      },
    });
  });

  it('should preserve stale tag ids on archived tasks (harmless, see #6270)', () => {
    const existingTag: Tag = {
      ...DEFAULT_TAG,
      id: 'existingTag',
      title: 'Existing Tag',
      taskIds: [],
    };

    const tagState: TagState = {
      ...fakeEntityStateFromArray<Tag>([TODAY_TAG, existingTag]),
    } as TagState;

    const archiveTask: Task = {
      ...DEFAULT_TASK,
      id: 'archived-1',
      tagIds: ['existingTag', 'missingTag', TODAY_TAG.id],
      projectId: '',
    };

    const archiveTaskState: TaskArchive = {
      ids: [archiveTask.id],
      entities: {
        [archiveTask.id]: archiveTask,
      },
    };

    const result = dataRepair({
      ...mock,
      tag: tagState,
      archiveYoung: {
        ...mock.archiveYoung,
        task: archiveTaskState,
      },
    });

    const repairedTask = result.data.archiveYoung.task.entities['archived-1'] as Task;

    // Stale tagIds on archived tasks are preserved (#6270), but TODAY_TAG is
    // always stripped (architectural invariant: TODAY_TAG must never be in tagIds)
    expect(repairedTask.tagIds).toEqual(['existingTag', 'missingTag']);
  });

  it('should remove notes with missing data from the project lists', () => {
    const noteState = {
      ...mock.note,
      ids: ['EXISTING'],
      entities: {
        EXISTING: { id: 'EXISTING', projectId: 'TEST_ID_PROJECT' },
      },
      todayOrder: [],
    } as any;

    const projectState: ProjectState = {
      ...fakeEntityStateFromArray([
        {
          title: 'TEST_PROJECT',
          id: 'TEST_ID_PROJECT',
          taskIds: [],
          backlogTaskIds: [],
          noteIds: ['EXISTING', 'goneProject', 'noneExisting'],
        },
        INBOX_PROJECT,
      ] as Partial<Project>[]),
    };

    expect(
      dataRepair({
        ...mock,
        project: projectState,
        note: {
          ...noteState,
        } as any,
      }).data,
    ).toEqual({
      ...mock,
      note: noteState as any,
      project: {
        ...projectState,
        entities: {
          TEST_ID_PROJECT: {
            title: 'TEST_PROJECT',
            id: 'TEST_ID_PROJECT',
            taskIds: [],
            backlogTaskIds: [],
            noteIds: ['EXISTING'],
          },
          INBOX_PROJECT,
        } as any,
      },
    });
  });

  it('should remove tasks archived sub tasks from any project lists', () => {
    const taskArchiveState = {
      ...mock.archiveYoung.task,
      ids: ['PAR_ID', 'SUB_ID'],
      entities: {
        SUB_ID: {
          ...DEFAULT_TASK,
          id: 'SUB_ID',
          projectId: 'TEST_PROJECT',
          parentId: 'PAR_ID',
        },
        PAR_ID: { ...DEFAULT_TASK, id: 'PAR_ID', projectId: 'TEST_PROJECT' },
      },
    } as any;

    const projectState: ProjectState = {
      ...fakeEntityStateFromArray([
        {
          title: 'TEST_PROJECT',
          id: 'TEST_ID_PROJECT',
          taskIds: [],
          backlogTaskIds: ['SUB_ID'],
          noteIds: [],
        },
        INBOX_PROJECT,
      ] as Partial<Project>[]),
    };

    expect(
      dataRepair({
        ...mock,
        project: projectState,
        archiveYoung: {
          lastTimeTrackingFlush: 0,
          timeTracking: mock.archiveYoung.timeTracking,
          task: taskArchiveState,
        },
      }).data,
    ).toEqual({
      ...mock,
      archiveYoung: {
        lastTimeTrackingFlush: 0,
        timeTracking: mock.archiveYoung.timeTracking,
        task: taskArchiveState,
      },
      project: {
        ...projectState,
        entities: {
          TEST_ID_PROJECT: {
            title: 'TEST_PROJECT',
            id: 'TEST_ID_PROJECT',
            taskIds: [],
            backlogTaskIds: [],
            noteIds: [],
          },
          INBOX_PROJECT,
        } as any,
      },
    });
  });

  it('should delete missing tasks for projects backlog list', () => {
    const taskState = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'TEST',
          title: 'TEST',
        },
      ]),
    } as any;

    const projectState: ProjectState = {
      ...fakeEntityStateFromArray([
        {
          title: 'TEST_PROJECT',
          id: 'TEST_ID_PROJECT',
          taskIds: [],
          backlogTaskIds: ['goneProject', 'TEST', 'noneExisting'],
          noteIds: [],
        },
        INBOX_PROJECT,
      ] as Partial<Project>[]),
    };

    expect(
      dataRepair({
        ...mock,
        project: projectState,
        task: taskState,
      }).data,
    ).toEqual({
      ...mock,
      task: taskState as any,
      project: {
        ...projectState,
        entities: {
          TEST_ID_PROJECT: {
            title: 'TEST_PROJECT',
            id: 'TEST_ID_PROJECT',
            taskIds: [],
            backlogTaskIds: ['TEST'],
            noteIds: [],
          },
          INBOX_PROJECT,
        } as any,
      },
    });
  });

  describe('should fix duplicate entities for', () => {
    it('task', () => {
      expect(
        dataRepair({
          ...mock,
          task: {
            ...mock.task,
            ...fakeEntityStateFromArray<Task>([
              {
                ...DEFAULT_TASK,
                id: 'DUPE',
                title: 'DUPE',
                projectId: FAKE_PROJECT_ID,
              },
              {
                ...DEFAULT_TASK,
                id: 'DUPE',
                title: 'DUPE',
                projectId: FAKE_PROJECT_ID,
              },
              {
                ...DEFAULT_TASK,
                id: 'NO_DUPE',
                title: 'NO_DUPE',
                projectId: FAKE_PROJECT_ID,
              },
            ]),
          } as any,
        }).data,
      ).toEqual({
        ...mock,
        task: {
          ...mock.task,
          ...fakeEntityStateFromArray<Task>([
            {
              ...DEFAULT_TASK,
              id: 'DUPE',
              title: 'DUPE',
              projectId: FAKE_PROJECT_ID,
            },
            {
              ...DEFAULT_TASK,
              id: 'NO_DUPE',
              title: 'NO_DUPE',
              projectId: FAKE_PROJECT_ID,
            },
          ]),
        } as any,
      });
    });

    // TODO check to re-implement properly?? Now it seems to never to trigger something since duplicate entityIds are not possible this way??
    //   it('archiveYoung.task', () => {
    //     expect(
    //       dataRepair({
    //         ...mock,
    //         archiveYoung: {
    //           lastTimeTrackingFlush: 0,
    //           timeTracking: mock.archiveYoung.timeTracking,
    //           task: {
    //             ...mock.archiveYoung.task,
    //             ...fakeEntityStateFromArray<Task>([
    //               {
    //                 ...DEFAULT_TASK,
    //                 id: 'DUPE',
    //                 title: 'DUPE',
    //                 projectId: FAKE_PROJECT_ID,
    //               },
    //               {
    //                 ...DEFAULT_TASK,
    //                 id: 'DUPE',
    //                 title: 'DUPE',
    //                 projectId: FAKE_PROJECT_ID,
    //               },
    //               {
    //                 ...DEFAULT_TASK,
    //                 id: 'NO_DUPE',
    //                 title: 'NO_DUPE',
    //                 projectId: FAKE_PROJECT_ID,
    //               },
    //             ]),
    //           } as any,
    //         },
    //       }),
    //     ).toEqual({
    //       ...mock,
    //       archiveYoung: {
    //         lastTimeTrackingFlush: 0,
    //         timeTracking: mock.archiveYoung.timeTracking,
    //         task: {
    //           ...mock.archiveYoung.task,
    //           ...fakeEntityStateFromArray<Task>([
    //             {
    //               ...DEFAULT_TASK,
    //               id: 'DUPE',
    //               title: 'DUPE',
    //               projectId: FAKE_PROJECT_ID,
    //             },
    //             {
    //               ...DEFAULT_TASK,
    //               id: 'NO_DUPE',
    //               title: 'NO_DUPE',
    //               projectId: FAKE_PROJECT_ID,
    //             },
    //           ]),
    //         } as any,
    //       },
    //     });
    //   });
  });

  describe('should fix inconsistent entity states for', () => {
    it('task', () => {
      expect(
        dataRepair({
          ...mock,
          task: {
            ids: ['AAA, XXX', 'YYY'],
            entities: {
              AAA: { ...DEFAULT_TASK, id: 'AAA', projectId: FAKE_PROJECT_ID },
              CCC: { ...DEFAULT_TASK, id: 'CCC', projectId: FAKE_PROJECT_ID },
            },
          } as any,
        }).data,
      ).toEqual({
        ...mock,
        task: {
          ids: ['AAA', 'CCC'],
          entities: {
            AAA: { ...DEFAULT_TASK, id: 'AAA', projectId: FAKE_PROJECT_ID },
            CCC: { ...DEFAULT_TASK, id: 'CCC', projectId: FAKE_PROJECT_ID },
          },
        } as any,
      });
    });
    it('taskArchive', () => {
      expect(
        dataRepair({
          ...mock,
          archiveYoung: {
            lastTimeTrackingFlush: 0,
            timeTracking: mock.archiveYoung.timeTracking,
            task: {
              ids: ['AAA, XXX', 'YYY'],
              entities: {
                AAA: { ...DEFAULT_TASK, id: 'AAA', projectId: FAKE_PROJECT_ID },
                CCC: { ...DEFAULT_TASK, id: 'CCC', projectId: FAKE_PROJECT_ID },
              },
            } as any,
          },
        }).data,
      ).toEqual({
        ...mock,
        archiveYoung: {
          lastTimeTrackingFlush: 0,
          timeTracking: mock.archiveYoung.timeTracking,
          task: {
            ids: ['AAA', 'CCC'],
            entities: {
              AAA: { ...DEFAULT_TASK, id: 'AAA', projectId: FAKE_PROJECT_ID },
              CCC: { ...DEFAULT_TASK, id: 'CCC', projectId: FAKE_PROJECT_ID },
            },
          } as any,
        },
      });
    });

    it('taskArchive with malformed undefined entity', () => {
      expect(
        dataRepair({
          ...mock,
          archiveYoung: {
            lastTimeTrackingFlush: 0,
            timeTracking: mock.archiveYoung.timeTracking,
            task: {
              ids: ['VALID_TASK', null],
              entities: {
                VALID_TASK: {
                  ...DEFAULT_TASK,
                  id: 'VALID_TASK',
                  projectId: FAKE_PROJECT_ID,
                },
                undefined: {
                  isDone: true,
                  doneOn: 1775783824920,
                  subTasks: [],
                },
              },
            } as any,
          },
        }).data,
      ).toEqual({
        ...mock,
        archiveYoung: {
          lastTimeTrackingFlush: 0,
          timeTracking: mock.archiveYoung.timeTracking,
          task: {
            ids: ['VALID_TASK'],
            entities: {
              VALID_TASK: {
                ...DEFAULT_TASK,
                id: 'VALID_TASK',
                projectId: FAKE_PROJECT_ID,
              },
            },
          } as any,
        },
      });
    });
  });

  it('should restore missing tasks from taskArchive if available', () => {
    const taskArchiveState = {
      ...mock.archiveYoung.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'goneToArchiveToday',
          title: 'goneToArchiveToday',
          projectId: 'TEST_ID_PROJECT',
        },
        {
          ...DEFAULT_TASK,
          id: 'goneToArchiveBacklog',
          title: 'goneToArchiveBacklog',
          projectId: 'TEST_ID_PROJECT',
        },
      ]),
    } as any;

    const projectState: ProjectState = {
      ...fakeEntityStateFromArray([
        {
          title: 'TEST_PROJECT',
          id: 'TEST_ID_PROJECT',
          taskIds: ['goneToArchiveToday', 'GONE'],
          backlogTaskIds: ['goneToArchiveBacklog', 'GONE'],
          noteIds: [],
        },
      ] as Partial<Project>[]),
    };

    expect(
      dataRepair({
        ...mock,
        project: projectState,
        archiveYoung: {
          lastTimeTrackingFlush: 0,
          timeTracking: mock.archiveYoung.timeTracking,
          task: taskArchiveState,
        },
        task: {
          ...mock.task,
          ...createEmptyEntity(),
        } as any,
      }).data,
    ).toEqual({
      ...mock,
      task: {
        ...mock.task,
        ...fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 'goneToArchiveToday',
            title: 'goneToArchiveToday',
            projectId: 'TEST_ID_PROJECT',
          },
          {
            ...DEFAULT_TASK,
            id: 'goneToArchiveBacklog',
            title: 'goneToArchiveBacklog',
            projectId: 'TEST_ID_PROJECT',
          },
        ]),
      } as any,
      project: {
        ...projectState,
        ids: [INBOX_PROJECT.id, 'TEST_ID_PROJECT'],
        entities: {
          TEST_ID_PROJECT: {
            title: 'TEST_PROJECT',
            id: 'TEST_ID_PROJECT',
            taskIds: ['goneToArchiveToday'],
            backlogTaskIds: ['goneToArchiveBacklog'],
            noteIds: [],
          },
          INBOX_PROJECT,
        } as any,
      },
    });
  });

  it('should add orphan tasks to their project list', () => {
    const taskState = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'orphanedTask',
          title: 'orphanedTask',
          projectId: 'TEST_ID_PROJECT',
          parentId: undefined,
        },
        {
          ...DEFAULT_TASK,
          id: 'orphanedTaskOtherProject',
          title: 'orphanedTaskOtherProject',
          projectId: 'TEST_ID_PROJECT_OTHER',
          parentId: undefined,
        },
        {
          ...DEFAULT_TASK,
          id: 'regularTaskOtherProject',
          title: 'regularTaskOtherProject',
          projectId: 'TEST_ID_PROJECT_OTHER',
          parentId: undefined,
        },
      ]),
    } as any;

    const projectState: ProjectState = {
      ...fakeEntityStateFromArray([
        {
          title: 'TEST_PROJECT',
          id: 'TEST_ID_PROJECT',
          taskIds: ['GONE'],
          backlogTaskIds: [],
          noteIds: [],
        },
        {
          title: 'TEST_PROJECT_OTHER',
          id: 'TEST_ID_PROJECT_OTHER',
          taskIds: ['regularTaskOtherProject'],
          backlogTaskIds: [],
          noteIds: [],
        },
        INBOX_PROJECT,
      ] as Partial<Project>[]),
    };

    expect(
      dataRepair({
        ...mock,
        project: projectState,
        task: taskState,
      }).data,
    ).toEqual({
      ...mock,
      task: taskState,
      project: {
        ...projectState,
        entities: {
          TEST_ID_PROJECT: {
            title: 'TEST_PROJECT',
            id: 'TEST_ID_PROJECT',
            taskIds: ['orphanedTask'],
            backlogTaskIds: [],
            noteIds: [],
          },
          TEST_ID_PROJECT_OTHER: {
            title: 'TEST_PROJECT_OTHER',
            id: 'TEST_ID_PROJECT_OTHER',
            taskIds: ['regularTaskOtherProject', 'orphanedTaskOtherProject'],
            backlogTaskIds: [],
            noteIds: [],
          },
          INBOX_PROJECT,
        } as any,
      },
    });
  });

  it('should convert orphaned archived subtask to main task by setting parentId to undefined', () => {
    const taskStateBefore = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        // No parent task exists in regular tasks
      ]),
    } as any;

    const taskArchiveStateBefore = {
      ...mock.archiveYoung.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'orphanedSubTask',
          title: 'Orphaned SubTask',
          parentId: 'nonExistentParent', // Parent doesn't exist anywhere
          projectId: FAKE_PROJECT_ID,
        },
      ]),
    } as any;

    const result = dataRepair({
      ...mock,
      task: taskStateBefore,
      archiveYoung: {
        lastTimeTrackingFlush: 0,
        timeTracking: mock.archiveYoung.timeTracking,
        task: taskArchiveStateBefore,
      },
    });

    // The orphaned subtask should remain in archive but have parentId set to undefined
    expect(result.data.archiveYoung.task.entities['orphanedSubTask']).toEqual({
      ...DEFAULT_TASK,
      id: 'orphanedSubTask',
      title: 'Orphaned SubTask',
      parentId: undefined, // parentId should be set to undefined
      projectId: FAKE_PROJECT_ID,
    });
    expect(result.data.archiveYoung.task.ids).toContain('orphanedSubTask');
  });

  it('should move archived sub tasks back to their unarchived parents', () => {
    const taskStateBefore = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'subTaskUnarchived',
          title: 'subTaskUnarchived',
          parentId: 'parent',
          projectId: FAKE_PROJECT_ID,
        },
        {
          ...DEFAULT_TASK,
          id: 'parent',
          title: 'parent',
          parentId: undefined,
          subTaskIds: ['subTaskUnarchived'],
          projectId: FAKE_PROJECT_ID,
        },
      ]),
    } as any;

    const taskArchiveStateBefore = {
      ...mock.archiveYoung.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'subTaskArchived',
          title: 'subTaskArchived',
          parentId: 'parent',
          projectId: FAKE_PROJECT_ID,
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        task: taskStateBefore,
        archiveYoung: {
          lastTimeTrackingFlush: 0,
          timeTracking: mock.archiveYoung.timeTracking,
          task: taskArchiveStateBefore,
        },
      }).data,
    ).toEqual({
      ...mock,
      task: {
        ...mock.task,
        ...fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 'subTaskUnarchived',
            title: 'subTaskUnarchived',
            parentId: 'parent',
            projectId: FAKE_PROJECT_ID,
          },
          {
            ...DEFAULT_TASK,
            id: 'parent',
            title: 'parent',
            parentId: undefined,
            subTaskIds: ['subTaskUnarchived', 'subTaskArchived'],
            projectId: FAKE_PROJECT_ID,
          },
          {
            ...DEFAULT_TASK,
            id: 'subTaskArchived',
            title: 'subTaskArchived',
            parentId: 'parent',
            projectId: FAKE_PROJECT_ID,
          },
        ]),
      } as any,
      archiveYoung: {
        lastTimeTrackingFlush: 0,
        timeTracking: mock.archiveYoung.timeTracking,
        task: {
          ...mock.archiveYoung.task,
          ...fakeEntityStateFromArray<Task>([]),
        } as any,
      },
    });
  });

  it('should move unarchived sub tasks to their archived parents', () => {
    const taskStateBefore = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'subTaskUnarchived',
          title: 'subTaskUnarchived',
          parentId: 'parent',
        },
      ]),
    } as any;

    const taskArchiveStateBefore = {
      ...mock.archiveYoung.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'subTaskArchived',
          title: 'subTaskArchived',
          parentId: 'parent',
        },
        {
          ...DEFAULT_TASK,
          id: 'parent',
          title: 'parent',
          parentId: undefined,
          subTaskIds: ['subTaskArchived'],
          projectId: FAKE_PROJECT_ID,
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        task: taskStateBefore,
        archiveYoung: {
          lastTimeTrackingFlush: 0,
          timeTracking: mock.archiveYoung.timeTracking,
          task: taskArchiveStateBefore,
        },
      }).data,
    ).toEqual({
      ...mock,
      task: {
        ...mock.task,
        ...fakeEntityStateFromArray<Task>([]),
      } as any,
      archiveYoung: {
        lastTimeTrackingFlush: 0,
        timeTracking: mock.archiveYoung.timeTracking,
        task: {
          ...mock.archiveYoung.task,
          ...fakeEntityStateFromArray<Task>([
            {
              ...DEFAULT_TASK,
              id: 'subTaskArchived',
              title: 'subTaskArchived',
              parentId: 'parent',
              projectId: FAKE_PROJECT_ID,
            },
            {
              ...DEFAULT_TASK,
              id: 'parent',
              title: 'parent',
              parentId: undefined,
              subTaskIds: ['subTaskArchived', 'subTaskUnarchived'],
              projectId: FAKE_PROJECT_ID,
            },
            {
              ...DEFAULT_TASK,
              id: 'subTaskUnarchived',
              title: 'subTaskUnarchived',
              parentId: 'parent',
              projectId: FAKE_PROJECT_ID,
            },
          ]),
        } as any,
      },
    });
  });

  it('should assign task projectId according to parent', () => {
    const project = {
      ...mock.project,
      ...fakeEntityStateFromArray<Project>([
        {
          ...DEFAULT_PROJECT,
          id: 'p1',
        },
        INBOX_PROJECT,
      ]),
    } as any;

    const taskStateBefore = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'subTask1',
          title: 'subTask1',
          projectId: undefined,
          parentId: 'parent',
        },
        {
          ...DEFAULT_TASK,
          id: 'subTask2',
          title: 'subTask2',
          projectId: undefined,
          parentId: 'parent',
        },
        {
          ...DEFAULT_TASK,
          id: 'parent',
          title: 'parent',
          parentId: undefined,
          projectId: 'p1',
          subTaskIds: ['subTask1', 'subTask2'],
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        project,
        task: taskStateBefore,
      }).data,
    ).toEqual({
      ...mock,
      project,
      task: {
        ...mock.task,
        ...fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 'subTask1',
            title: 'subTask1',
            parentId: 'parent',
            projectId: 'p1',
          },
          {
            ...DEFAULT_TASK,
            id: 'subTask2',
            title: 'subTask2',
            parentId: 'parent',
            projectId: 'p1',
          },
          {
            ...DEFAULT_TASK,
            id: 'parent',
            title: 'parent',
            parentId: undefined,
            subTaskIds: ['subTask1', 'subTask2'],
            projectId: 'p1',
          },
        ]),
      } as any,
    });
  });

  it('should delete non-existent project ids for tasks in "task"', () => {
    const taskState = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'TEST',
          title: 'TEST',
          projectId: 'NON_EXISTENT',
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        task: taskState,
      } as any).data,
    ).toEqual({
      ...mock,
      task: {
        ...taskState,
        entities: {
          TEST: {
            ...taskState.entities.TEST,
          },
        },
      },
    });
  });

  it('should preserve stale projectId on archived tasks (harmless, see #6270)', () => {
    const taskArchiveState = {
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'TEST',
          title: 'TEST',
          projectId: 'NON_EXISTENT',
        },
      ]),
    } as any;

    const result = dataRepair({
      ...mock,
      archiveYoung: {
        lastTimeTrackingFlush: 0,
        timeTracking: mock.archiveYoung.timeTracking,
        task: taskArchiveState,
      },
    } as any);

    // Stale projectId on archived tasks is harmless — preserved, not rewritten
    expect(result.data.archiveYoung.task.entities['TEST']!.projectId).toBe(
      'NON_EXISTENT',
    );
  });

  it('should delete non-existent project ids for issueProviders', () => {
    const issueProviderState = {
      ...mock.issueProvider,
      ...fakeEntityStateFromArray<IssueProvider>([
        {
          id: 'TEST',
          defaultProjectId: 'NON_EXISTENT',
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        issueProvider: issueProviderState,
      } as any).data,
    ).toEqual({
      ...mock,
      issueProvider: {
        ...issueProviderState,
        entities: {
          TEST: {
            ...issueProviderState.entities.TEST,
            defaultProjectId: null,
          },
        },
      },
    });
  });

  it('should delete non-existent project ids for taskRepeatCfgCfgs', () => {
    const taskRepeatCfgState = {
      ...mock.taskRepeatCfg,
      ...fakeEntityStateFromArray<TaskRepeatCfg>([
        {
          id: 'TEST',
          title: 'TEST',
          projectId: 'NON_EXISTENT',
          lastTaskCreationDay: '1970-01-01',
          defaultEstimate: undefined,
          startTime: undefined,
          remindAt: undefined,
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: true,
          sunday: true,
          tagIds: ['SOME_TAG'],
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        taskRepeatCfg: taskRepeatCfgState,
      } as any).data,
    ).toEqual({
      ...mock,
      taskRepeatCfg: {
        ...taskRepeatCfgState,
        entities: {
          TEST: {
            ...taskRepeatCfgState.entities.TEST,
          },
        },
      },
    });
  });

  it('should delete non-existent taskRepeatCfg if projectId is missing and no tags', () => {
    const taskRepeatCfgState = {
      ...mock.taskRepeatCfg,
      ...fakeEntityStateFromArray<TaskRepeatCfg>([
        {
          id: 'TEST',
          title: 'TEST',
          projectId: 'NON_EXISTENT',
          lastTaskCreationDay: '1970-01-01',
          defaultEstimate: undefined,
          startTime: undefined,
          remindAt: undefined,
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: true,
          sunday: true,
          tagIds: [],
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        taskRepeatCfg: taskRepeatCfgState,
      } as any).data,
    ).toEqual({
      ...mock,
      taskRepeatCfg: {
        ...taskRepeatCfgState,
        ids: [],
        entities: {},
      },
    });
  });

  it('should clear non-existent repeatCfgId from tasks', () => {
    const taskState = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 't1',
          projectId: INBOX_PROJECT.id,
          repeatCfgId: 'NON_EXISTENT_REPEAT_CFG',
        },
        {
          ...DEFAULT_TASK,
          id: 't2',
          projectId: INBOX_PROJECT.id,
          repeatCfgId: undefined,
        },
      ]),
    } as any;

    const result = dataRepair({
      ...mock,
      task: taskState,
    } as any);

    // repeatCfgId should be cleared from t1 since it doesn't exist
    expect(result.data.task.entities.t1!.repeatCfgId).toBeUndefined();
    // t2 should remain unchanged
    expect(result.data.task.entities.t2!.repeatCfgId).toBeUndefined();
  });

  it('should preserve stale repeatCfgId on archived tasks (harmless, see #6270)', () => {
    const archiveYoungState = {
      task: {
        ...fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 'archived-t1',
            projectId: INBOX_PROJECT.id,
            repeatCfgId: 'NON_EXISTENT_REPEAT_CFG',
          },
        ]),
      },
      timeTracking: {},
      lastTimeTrackingFlush: 0,
    };

    const result = dataRepair({
      ...mock,
      archiveYoung: archiveYoungState,
    } as any);

    // Stale repeatCfgId on archived tasks is harmless — preserved, not cleared
    expect(result.data.archiveYoung.task.entities['archived-t1']!.repeatCfgId).toBe(
      'NON_EXISTENT_REPEAT_CFG',
    );
  });

  it('should preserve valid repeatCfgId on tasks', () => {
    const taskRepeatCfgState = {
      ...mock.taskRepeatCfg,
      ...fakeEntityStateFromArray<TaskRepeatCfg>([
        {
          ...DEFAULT_TASK_REPEAT_CFG,
          id: 'VALID_REPEAT_CFG',
          title: 'Valid Repeat',
          projectId: INBOX_PROJECT.id,
        },
      ]),
    } as any;

    const taskState = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 't1',
          projectId: INBOX_PROJECT.id,
          repeatCfgId: 'VALID_REPEAT_CFG',
        },
      ]),
    } as any;

    const result = dataRepair({
      ...mock,
      task: taskState,
      taskRepeatCfg: taskRepeatCfgState,
    } as any);

    // repeatCfgId should be preserved since it exists
    expect(result.data.task.entities.t1!.repeatCfgId).toBe('VALID_REPEAT_CFG');
  });

  it('should remove from project list if task has wrong project id', () => {
    const project = {
      ...mock.project,
      ...fakeEntityStateFromArray<Project>([
        INBOX_PROJECT,
        {
          ...DEFAULT_PROJECT,
          id: 'p1',
          taskIds: ['t1', 't2'],
        },
        {
          ...DEFAULT_PROJECT,
          id: 'p2',
          taskIds: ['t1'],
        },
      ]),
    } as any;

    const task = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 't1',
          projectId: 'p1',
        },
        {
          ...DEFAULT_TASK,
          id: 't2',
          projectId: 'p1',
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        project,
        task,
      }).data,
    ).toEqual({
      ...mock,
      project: {
        ...project,
        ...fakeEntityStateFromArray<Project>([
          INBOX_PROJECT,
          {
            ...DEFAULT_PROJECT,
            id: 'p1',
            taskIds: ['t1', 't2'],
          },
          {
            ...DEFAULT_PROJECT,
            id: 'p2',
            taskIds: [],
          },
        ]),
      },
      task,
    });
  });

  it('should move to project if task has no projectId', () => {
    const project = {
      ...mock.project,
      ...fakeEntityStateFromArray<Project>([
        INBOX_PROJECT,
        {
          ...DEFAULT_PROJECT,
          id: 'p1',
          taskIds: ['t1', 't2'],
        },
      ]),
    } as any;

    const task = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 't1',
          projectId: 'p1',
        },
        {
          ...DEFAULT_TASK,
          id: 't2',
          projectId: undefined,
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        project,
        task,
      }).data,
    ).toEqual({
      ...mock,
      project,
      task: {
        ...mock.task,
        ...fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 't1',
            projectId: 'p1',
          },
          {
            ...DEFAULT_TASK,
            id: 't2',
            projectId: 'p1',
          },
        ]),
      } as any,
    });
  });

  it('should move to project if backlogTask has no projectId', () => {
    const project = {
      ...mock.project,
      ...fakeEntityStateFromArray<Project>([
        INBOX_PROJECT,
        {
          ...DEFAULT_PROJECT,
          id: 'p1',
          backlogTaskIds: ['t1', 't2'],
        },
      ]),
    } as any;

    const task = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 't1',
          projectId: 'p1',
        },
        {
          ...DEFAULT_TASK,
          id: 't2',
          projectId: undefined,
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        project,
        task,
      }).data,
    ).toEqual({
      ...mock,
      project,
      task: {
        ...mock.task,
        ...fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 't1',
            projectId: 'p1',
          },
          {
            ...DEFAULT_TASK,
            id: 't2',
            projectId: 'p1',
          },
        ]),
      } as any,
    });
  });

  it('should add tagId to task if listed, but task does not contain it', () => {
    const tag = {
      ...mock.tag,
      ...fakeEntityStateFromArray<Tag>([
        {
          ...DEFAULT_TAG,
          id: 'tag1',
          taskIds: ['task1', 'task2'],
        },
      ]),
    } as any;

    const task = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'task1',
          tagIds: ['tag1'],
        },
        {
          ...DEFAULT_TASK,
          id: 'task2',
          tagIds: [],
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        tag,
        task,
      }).data,
    ).toEqual({
      ...mock,
      tag,
      task: {
        ...mock.task,
        ...fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 'task1',
            tagIds: ['tag1'],
            projectId: INBOX_PROJECT.id,
          },
          {
            ...DEFAULT_TASK,
            id: 'task2',
            tagIds: ['tag1'],
            projectId: INBOX_PROJECT.id,
          },
        ]),
      } as any,
    });
  });

  // !!! NOTE: does not test, what it is supposed to
  it('should cleanup orphaned sub tasks', () => {
    const task = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'task1',
          subTaskIds: ['s1', 's2GONE'],
          projectId: FAKE_PROJECT_ID,
        },
        {
          ...DEFAULT_TASK,
          id: 's1',
          parentId: 'task1',
          projectId: FAKE_PROJECT_ID,
        },
      ]),
    } as any;

    const taskArchive = {
      ...mock.archiveYoung.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'archiveTask1',
          subTaskIds: ['as1', 'as2GONE'],
          projectId: FAKE_PROJECT_ID,
        },
        {
          ...DEFAULT_TASK,
          id: 'as1',
          parentId: 'archiveTask1',
          projectId: FAKE_PROJECT_ID,
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        task,
        archiveYoung: {
          lastTimeTrackingFlush: 0,
          timeTracking: mock.archiveYoung.timeTracking,
          task: taskArchive,
        },
      }).data,
    ).toEqual({
      ...mock,
      task: {
        ...mock.task,
        ...fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 'task1',
            subTaskIds: ['s1'],
            projectId: FAKE_PROJECT_ID,
          },
          {
            ...DEFAULT_TASK,
            id: 's1',
            parentId: 'task1',
            projectId: FAKE_PROJECT_ID,
          },
        ]),
      } as any,
      archiveYoung: {
        lastTimeTrackingFlush: 0,
        timeTracking: mock.archiveYoung.timeTracking,
        task: {
          ...mock.archiveYoung.task,
          ...fakeEntityStateFromArray<Task>([
            {
              ...DEFAULT_TASK,
              id: 'archiveTask1',
              subTaskIds: ['as1'],
              projectId: FAKE_PROJECT_ID,
            },
            {
              ...DEFAULT_TASK,
              id: 'as1',
              parentId: 'archiveTask1',
              projectId: FAKE_PROJECT_ID,
            },
          ]),
        } as any,
      },
    });
  });

  it('should cleanup missing sub tasks from their parent', () => {
    const task = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'task1',
          subTaskIds: ['s2GONE'],
          projectId: FAKE_PROJECT_ID,
        },
      ]),
    } as any;

    const taskArchive = {
      ...mock.archiveYoung.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'archiveTask1',
          subTaskIds: ['as2GONE', 'other gone'],
          projectId: FAKE_PROJECT_ID,
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        task,
        archiveYoung: {
          lastTimeTrackingFlush: 0,
          timeTracking: mock.archiveYoung.timeTracking,
          task: taskArchive,
        },
      }).data,
    ).toEqual({
      ...mock,
      task: {
        ...mock.task,
        ...fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 'task1',
            subTaskIds: [],
            projectId: FAKE_PROJECT_ID,
          },
        ]),
      } as any,
      archiveYoung: {
        lastTimeTrackingFlush: 0,
        timeTracking: mock.archiveYoung.timeTracking,
        task: {
          ...mock.archiveYoung.task,
          ...fakeEntityStateFromArray<Task>([
            {
              ...DEFAULT_TASK,
              id: 'archiveTask1',
              subTaskIds: [],
              projectId: FAKE_PROJECT_ID,
            },
          ]),
        } as any,
      },
    });
  });

  it('should add default project id if none', () => {
    const task = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'task1',
          subTaskIds: ['sub_task'],
        },
        {
          ...DEFAULT_TASK,
          id: 'task2',
          projectId: FAKE_PROJECT_ID,
        },
        {
          ...DEFAULT_TASK,
          id: 'sub_task',
          parentId: 'task1',
        },
      ]),
    } as any;

    const taskArchive = {
      ...mock.archiveYoung.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'archiveTask1',
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        task,
        archiveYoung: {
          lastTimeTrackingFlush: 0,
          timeTracking: mock.archiveYoung.timeTracking,
          task: taskArchive,
        },
      }).data,
    ).toEqual({
      ...mock,
      task: {
        ...mock.task,
        ...fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 'task1',
            subTaskIds: ['sub_task'],
            projectId: INBOX_PROJECT.id,
          },
          {
            ...DEFAULT_TASK,
            id: 'task2',
            projectId: FAKE_PROJECT_ID,
          },
          {
            ...DEFAULT_TASK,
            id: 'sub_task',
            parentId: 'task1',
            projectId: INBOX_PROJECT.id,
          },
        ]),
      } as any,
      archiveYoung: {
        lastTimeTrackingFlush: 0,
        timeTracking: mock.archiveYoung.timeTracking,
        task: {
          ...mock.archiveYoung.task,
          ...fakeEntityStateFromArray<Task>([
            {
              ...DEFAULT_TASK,
              id: 'archiveTask1',
              projectId: INBOX_PROJECT.id,
            },
          ]),
        } as any,
      },
    });
  });

  it('should clear legacy reminderId from tasks', () => {
    const taskState = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'TEST',
          title: 'TEST',
          dueWithTime: 12321,
        },
        {
          ...DEFAULT_TASK,
          id: 'TEST2',
          title: 'TEST2',
          dueWithTime: 12321,
        },
      ]),
    } as any;

    // Add legacy reminderId fields to simulate old data
    (taskState.entities.TEST as any).reminderId = 'R1';
    (taskState.entities.TEST2 as any).reminderId = 'R2_LEGACY';

    const result = dataRepair({
      ...mock,
      task: taskState,
      reminders: [],
    } as any);

    // Both tasks should have reminderId cleared (field removed)
    expect((result.data.task.entities.TEST as any).reminderId).toBeUndefined();
    expect((result.data.task.entities.TEST2 as any).reminderId).toBeUndefined();
    // dueWithTime should be preserved
    expect(result.data.task.entities.TEST!.dueWithTime).toBe(12321);
    expect(result.data.task.entities.TEST2!.dueWithTime).toBe(12321);
  });
  it('should add defaults to taskRepeatCfgs', () => {
    const taskRepeatCfg = {
      ...mock.taskRepeatCfg,
      ...fakeEntityStateFromArray<TaskRepeatCfg>([
        {
          ...DEFAULT_TASK_REPEAT_CFG,
          id: 'TEST',
          title: 'TEST',
          wednesday: undefined,
        },
        {
          ...DEFAULT_TASK_REPEAT_CFG,
          id: 'TEST2',
          title: 'TEST2',
          monday: undefined,
          tuesday: undefined,
          wednesday: undefined,
          friday: undefined,
          thursday: undefined,
          saturday: undefined,
          sunday: undefined,
        },
        {
          ...DEFAULT_TASK_REPEAT_CFG,
          id: 'TEST3',
          title: 'TEST3',
          monday: false,
          tuesday: false,
          wednesday: false,
          thursday: false,
          friday: false,
          saturday: false,
          sunday: false,
        },
        {
          ...DEFAULT_TASK_REPEAT_CFG,
          id: 'TEST4',
          title: 'TEST4',
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: true,
          sunday: true,
        },
      ]),
    } as any;

    expect(
      dataRepair({
        ...mock,
        taskRepeatCfg: taskRepeatCfg,
      } as any).data,
    ).toEqual({
      ...mock,
      taskRepeatCfg: {
        ...taskRepeatCfg,
        entities: {
          TEST: {
            ...taskRepeatCfg.entities.TEST,
            wednesday: false,
          },
          TEST2: {
            ...taskRepeatCfg.entities.TEST2,
            monday: false,
            tuesday: false,
            wednesday: false,
            thursday: false,
            friday: false,
            saturday: false,
            sunday: false,
          },
          TEST3: {
            ...taskRepeatCfg.entities.TEST3,
            monday: false,
            tuesday: false,
            wednesday: false,
            thursday: false,
            friday: false,
            saturday: false,
            sunday: false,
          },
          TEST4: {
            ...taskRepeatCfg.entities.TEST4,
            monday: true,
            tuesday: true,
            wednesday: true,
            thursday: true,
            friday: true,
            saturday: true,
            sunday: true,
          },
        },
      },
    });
  });

  it('should remove non-existent tags from active tasks but preserve on archived tasks (#6270)', () => {
    const tagState = {
      ...mock.tag,
      ...fakeEntityStateFromArray<Tag>([
        {
          ...DEFAULT_TAG,
          id: 'VALID_TAG',
          title: 'Valid Tag',
        },
      ]),
    } as any;

    const taskState = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'TASK1',
          title: 'Task 1',
          tagIds: ['VALID_TAG', 'NON_EXISTENT_TAG', 'ANOTHER_MISSING_TAG'],
          projectId: FAKE_PROJECT_ID,
        },
        {
          ...DEFAULT_TASK,
          id: 'TASK2',
          title: 'Task 2',
          tagIds: ['VALID_TAG'],
          projectId: FAKE_PROJECT_ID,
        },
        {
          ...DEFAULT_TASK,
          id: 'TASK3',
          title: 'Task 3',
          tagIds: ['NON_EXISTENT_TAG'],
          projectId: FAKE_PROJECT_ID,
        },
        {
          ...DEFAULT_TASK,
          id: 'TASK4',
          title: 'Task 4',
          tagIds: [TODAY_TAG.id, 'NON_EXISTENT_TAG'],
          projectId: FAKE_PROJECT_ID,
        },
      ]),
    } as any;

    const taskArchiveState = {
      ...mock.archiveYoung.task,
      ...fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'ARCHIVE_TASK1',
          title: 'Archive Task 1',
          tagIds: ['VALID_TAG', 'NON_EXISTENT_ARCHIVE_TAG'],
          projectId: FAKE_PROJECT_ID,
        },
        {
          ...DEFAULT_TASK,
          id: 'ARCHIVE_TASK2',
          title: 'Archive Task 2',
          tagIds: [TODAY_TAG.id, 'MISSING_TAG'],
          projectId: FAKE_PROJECT_ID,
        },
      ]),
    } as any;

    const result = dataRepair({
      ...mock,
      tag: tagState,
      task: taskState,
      archiveYoung: {
        lastTimeTrackingFlush: 0,
        timeTracking: mock.archiveYoung.timeTracking,
        task: taskArchiveState,
      },
    });

    // Active tasks: stale tags are stripped
    expect(result.data.task.entities['TASK1']?.tagIds).toEqual(['VALID_TAG']);
    expect(result.data.task.entities['TASK2']?.tagIds).toEqual(['VALID_TAG']);
    expect(result.data.task.entities['TASK3']?.tagIds).toEqual([]);
    expect(result.data.task.entities['TASK4']?.tagIds).toEqual([]);
    // Archived tasks: stale tags are preserved (#6270), but TODAY_TAG is always
    // stripped (architectural invariant: TODAY_TAG must never be in tagIds)
    expect(result.data.archiveYoung.task.entities['ARCHIVE_TASK1']?.tagIds).toEqual([
      'VALID_TAG',
      'NON_EXISTENT_ARCHIVE_TAG',
    ]);
    expect(result.data.archiveYoung.task.entities['ARCHIVE_TASK2']?.tagIds).toEqual([
      'MISSING_TAG',
    ]);
  });

  describe('should handle missing or undefined entity states (issue #6428)', () => {
    it('should not crash when issueProvider is undefined', () => {
      const result = dataRepair({
        ...mock,
        issueProvider: undefined,
      } as any);
      expect(result.data.issueProvider).toBeDefined();
      expect(result.data.issueProvider.ids).toEqual([]);
      expect(result.data.issueProvider.entities).toEqual({});
    });

    it('should not crash when issueProvider is null', () => {
      const result = dataRepair({
        ...mock,
        issueProvider: null,
      } as any);
      expect(result.data.issueProvider).toBeDefined();
      expect(result.data.issueProvider.ids).toEqual([]);
      expect(result.data.issueProvider.entities).toEqual({});
    });

    it('should not crash when taskRepeatCfg is undefined', () => {
      const result = dataRepair({
        ...mock,
        taskRepeatCfg: undefined,
      } as any);
      expect(result.data.taskRepeatCfg).toBeDefined();
      expect(result.data.taskRepeatCfg.ids).toEqual([]);
      expect(result.data.taskRepeatCfg.entities).toEqual({});
    });

    it('should not crash when multiple entity states are undefined', () => {
      const result = dataRepair({
        ...mock,
        issueProvider: undefined,
        taskRepeatCfg: undefined,
        note: undefined,
        metric: undefined,
        simpleCounter: undefined,
      } as any);
      expect(result.data.issueProvider.ids).toEqual([]);
      expect(result.data.issueProvider.entities).toEqual({});
      expect(result.data.taskRepeatCfg.ids).toEqual([]);
      expect(result.data.taskRepeatCfg.entities).toEqual({});
      expect(result.data.note.ids).toEqual([]);
      expect(result.data.note.entities).toEqual({});
      expect(result.data.metric.ids).toEqual([]);
      expect(result.data.metric.entities).toEqual({});
      expect(result.data.simpleCounter.ids).toEqual([]);
      expect(result.data.simpleCounter.entities).toEqual({});
    });

    it('should not crash when entity state is an empty object without entities', () => {
      const result = dataRepair({
        ...mock,
        issueProvider: {},
        taskRepeatCfg: {},
      } as any);
      expect(result.data.issueProvider.ids).toEqual([]);
      expect(result.data.issueProvider.entities).toEqual({});
      expect(result.data.taskRepeatCfg.ids).toEqual([]);
      expect(result.data.taskRepeatCfg.entities).toEqual({});
    });
  });

  describe('should fix repeat configs with invalid quickSetting (issue #5802)', () => {
    it('should change quickSetting to CUSTOM when WEEKLY_CURRENT_WEEKDAY has no startDate', () => {
      const taskRepeatCfgState = {
        ...mock.taskRepeatCfg,
        ...fakeEntityStateFromArray<TaskRepeatCfg>([
          {
            ...DEFAULT_TASK_REPEAT_CFG,
            id: 'TEST',
            title: 'TEST',
            quickSetting: 'WEEKLY_CURRENT_WEEKDAY',
            startDate: undefined,
          },
        ]),
      } as any;

      const result = dataRepair({
        ...mock,
        taskRepeatCfg: taskRepeatCfgState,
      } as any);

      expect(result.data.taskRepeatCfg.entities['TEST']?.quickSetting).toEqual('CUSTOM');
    });

    it('should change quickSetting to CUSTOM when YEARLY_CURRENT_DATE has no startDate', () => {
      const taskRepeatCfgState = {
        ...mock.taskRepeatCfg,
        ...fakeEntityStateFromArray<TaskRepeatCfg>([
          {
            ...DEFAULT_TASK_REPEAT_CFG,
            id: 'TEST',
            title: 'TEST',
            quickSetting: 'YEARLY_CURRENT_DATE',
            startDate: undefined,
          },
        ]),
      } as any;

      const result = dataRepair({
        ...mock,
        taskRepeatCfg: taskRepeatCfgState,
      } as any);

      expect(result.data.taskRepeatCfg.entities['TEST']?.quickSetting).toEqual('CUSTOM');
    });

    it('should change quickSetting to CUSTOM when MONTHLY_CURRENT_DATE has no startDate', () => {
      const taskRepeatCfgState = {
        ...mock.taskRepeatCfg,
        ...fakeEntityStateFromArray<TaskRepeatCfg>([
          {
            ...DEFAULT_TASK_REPEAT_CFG,
            id: 'TEST',
            title: 'TEST',
            quickSetting: 'MONTHLY_CURRENT_DATE',
            startDate: undefined,
          },
        ]),
      } as any;

      const result = dataRepair({
        ...mock,
        taskRepeatCfg: taskRepeatCfgState,
      } as any);

      expect(result.data.taskRepeatCfg.entities['TEST']?.quickSetting).toEqual('CUSTOM');
    });

    it('should NOT change quickSetting when startDate is provided', () => {
      const taskRepeatCfgState = {
        ...mock.taskRepeatCfg,
        ...fakeEntityStateFromArray<TaskRepeatCfg>([
          {
            ...DEFAULT_TASK_REPEAT_CFG,
            id: 'TEST',
            title: 'TEST',
            quickSetting: 'WEEKLY_CURRENT_WEEKDAY',
            startDate: '2024-01-15',
          },
        ]),
      } as any;

      const result = dataRepair({
        ...mock,
        taskRepeatCfg: taskRepeatCfgState,
      } as any);

      expect(result.data.taskRepeatCfg.entities['TEST']?.quickSetting).toEqual(
        'WEEKLY_CURRENT_WEEKDAY',
      );
    });

    it('should NOT change quickSetting for DAILY or CUSTOM', () => {
      const taskRepeatCfgState = {
        ...mock.taskRepeatCfg,
        ...fakeEntityStateFromArray<TaskRepeatCfg>([
          {
            ...DEFAULT_TASK_REPEAT_CFG,
            id: 'TEST_DAILY',
            title: 'TEST_DAILY',
            quickSetting: 'DAILY',
            startDate: undefined,
          },
          {
            ...DEFAULT_TASK_REPEAT_CFG,
            id: 'TEST_CUSTOM',
            title: 'TEST_CUSTOM',
            quickSetting: 'CUSTOM',
            startDate: undefined,
          },
        ]),
      } as any;

      const result = dataRepair({
        ...mock,
        taskRepeatCfg: taskRepeatCfgState,
      } as any);

      expect(result.data.taskRepeatCfg.entities['TEST_DAILY']?.quickSetting).toEqual(
        'DAILY',
      );
      expect(result.data.taskRepeatCfg.entities['TEST_CUSTOM']?.quickSetting).toEqual(
        'CUSTOM',
      );
    });
  });

  it('should return repairSummary with invalidReferencesRemoved when tag references non-existent task', () => {
    const task1: Task = {
      ...DEFAULT_TASK,
      id: 'task1',
      title: 'existing task',
      projectId: FAKE_PROJECT_ID,
      tagIds: ['tag1'],
    };
    mock.task = {
      ...mock.task,
      ...fakeEntityStateFromArray<Task>([task1]),
    } as any;
    mock.tag = fakeEntityStateFromArray<Tag>([
      {
        ...DEFAULT_TAG,
        id: 'tag1',
        title: 'Tag 1',
        taskIds: ['task1', 'non-existent-task'],
      },
      { ...TODAY_TAG, taskIds: [] },
    ]);
    (mock.project.entities[FAKE_PROJECT_ID] as any).taskIds = ['task1'];

    const result = dataRepair(mock);
    expect(result.repairSummary.invalidReferencesRemoved).toBeGreaterThan(0);
  });

  describe('invalid dueDay/deadlineDay sanitization (#6908)', () => {
    it('should clear invalid dueDay from task', () => {
      const taskState = {
        ...mock.task,
        ...fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 'INVALID_DUE',
            title: 'INVALID_DUE',
            projectId: FAKE_PROJECT_ID,
            dueDay: '-/-/2026' as any,
          },
        ]),
      } as any;
      (mock.project.entities[FAKE_PROJECT_ID] as any).taskIds = ['INVALID_DUE'];

      const result = dataRepair({
        ...mock,
        task: taskState,
      });

      expect(result.data.task.entities['INVALID_DUE']!.dueDay).toBeUndefined();
    });

    it('should clear invalid deadlineDay from task', () => {
      const taskState = {
        ...mock.task,
        ...fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 'INVALID_DEADLINE',
            title: 'INVALID_DEADLINE',
            projectId: FAKE_PROJECT_ID,
            deadlineDay: 'garbage' as any,
          },
        ]),
      } as any;
      (mock.project.entities[FAKE_PROJECT_ID] as any).taskIds = ['INVALID_DEADLINE'];

      const result = dataRepair({
        ...mock,
        task: taskState,
      });

      expect(result.data.task.entities['INVALID_DEADLINE']!.deadlineDay).toBeUndefined();
    });

    it('should preserve valid dueDay on task', () => {
      const taskState = {
        ...mock.task,
        ...fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 'VALID_DUE',
            title: 'VALID_DUE',
            projectId: FAKE_PROJECT_ID,
            dueDay: '2026-03-21',
          },
        ]),
      } as any;
      (mock.project.entities[FAKE_PROJECT_ID] as any).taskIds = ['VALID_DUE'];

      const result = dataRepair({
        ...mock,
        task: taskState,
      });

      expect(result.data.task.entities['VALID_DUE']!.dueDay).toBe('2026-03-21');
    });

    it('should clear invalid dueDay from archived task', () => {
      const archiveTask: Task = {
        ...DEFAULT_TASK,
        id: 'ARCHIVED_INVALID',
        title: 'ARCHIVED_INVALID',
        projectId: FAKE_PROJECT_ID,
        dueDay: '-/-/2026' as any,
      };

      const archiveTaskState: TaskArchive = {
        ids: [archiveTask.id],
        entities: {
          [archiveTask.id]: archiveTask,
        },
      };

      const result = dataRepair({
        ...mock,
        archiveYoung: {
          ...mock.archiveYoung,
          task: archiveTaskState,
        },
      });

      expect(
        result.data.archiveYoung.task.entities['ARCHIVED_INVALID']!.dueDay,
      ).toBeUndefined();
    });
  });
});
