import { isRelatedModelDataValid } from './is-related-model-data-valid';
import { DEFAULT_TASK, Task } from '../../features/tasks/task.model';
import { fakeEntityStateFromArray } from '../../util/fake-entity-state-from-array';
import { Project } from '../../features/project/project.model';
import { Tag } from '../../features/tag/tag.model';
import { createAppDataCompleteMock } from '../../util/app-data-mock';
import { DEFAULT_PROJECT, INBOX_PROJECT } from '../../features/project/project.const';
import { Note } from '../../features/note/note.model';
import { IssueProvider } from '../../features/issue/issue.model';
import { AppDataCompleteNew } from '../pfapi-config';

describe('isRelatedModelDataValid', () => {
  let mockAppData: AppDataCompleteNew;
  let alertSpy: jasmine.Spy;
  let confirmSpy: jasmine.Spy;

  beforeEach(() => {
    mockAppData = createAppDataCompleteMock();
    // Alert and confirm are already mocked globally, just get references and reset
    alertSpy = window.alert as jasmine.Spy;
    confirmSpy = window.confirm as jasmine.Spy;
    alertSpy.calls.reset();
    confirmSpy.calls.reset();
    confirmSpy.and.returnValue(true);
  });

  afterEach(() => {
    alertSpy.calls.reset();
    confirmSpy.calls.reset();
  });

  describe('valid data scenarios', () => {
    it('should return true for completely valid app data', () => {
      const result = isRelatedModelDataValid(mockAppData);

      expect(result).toBe(true);
    });

    it('should return true for minimal valid data structure', () => {
      const minimalData = {
        ...mockAppData,
        task: { ids: [], entities: {} },
        project: {
          ids: [INBOX_PROJECT.id],
          entities: { [INBOX_PROJECT.id]: INBOX_PROJECT },
        },
        tag: { ids: [], entities: {} },
      };

      const result = isRelatedModelDataValid(minimalData as any);

      expect(result).toBe(true);
    });
  });

  describe('project validation errors', () => {
    describe('missing task data', () => {
      it('should throw error when project references non-existent today task', () => {
        const invalidData = {
          ...mockAppData,
          task: mockAppData.task, // Empty task state
          project: {
            ...fakeEntityStateFromArray([
              {
                title: 'TEST_PROJECT',
                id: 'TEST_ID',
                taskIds: ['missing-task-id'],
                backlogTaskIds: [],
              },
            ] as Partial<Project>[]),
          },
        };

        expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
          'Missing task data (tid: missing-task-id) for Project TEST_PROJECT',
        );
      });

      it('should throw error when project references non-existent backlog task', () => {
        const invalidData = {
          ...mockAppData,
          task: mockAppData.task,
          project: {
            ...fakeEntityStateFromArray([
              {
                title: 'TEST_PROJECT',
                id: 'TEST_ID',
                taskIds: [],
                backlogTaskIds: ['missing-backlog-task'],
              },
            ] as Partial<Project>[]),
          },
        };

        expect(() => isRelatedModelDataValid(invalidData)).toThrowError(
          'Missing task data (tid: missing-backlog-task) for Project TEST_PROJECT',
        );
      });

      it('should throw error when project references multiple missing tasks', () => {
        const invalidData = {
          ...mockAppData,
          task: mockAppData.task,
          project: {
            ...fakeEntityStateFromArray([
              {
                title: 'TEST_PROJECT',
                id: 'TEST_ID',
                taskIds: ['missing-1', 'missing-2'],
                backlogTaskIds: [],
              },
            ] as Partial<Project>[]),
          },
        };

        // Should throw for the first missing task encountered
        expect(() => isRelatedModelDataValid(invalidData)).toThrowError(
          'Missing task data (tid: missing-1) for Project TEST_PROJECT',
        );
      });
    });

    describe('missing note data', () => {
      it('should throw error when project references non-existent note', () => {
        const invalidData = {
          ...mockAppData,
          project: {
            ...fakeEntityStateFromArray([
              {
                ...DEFAULT_PROJECT,
                id: 'PROJECT_WITH_NOTES',
                title: 'PROJECT_WITH_NOTES',
                noteIds: ['missing-note-id'],
              },
            ] as Partial<Project>[]),
          },
        };

        expect(() => isRelatedModelDataValid(invalidData)).toThrowError(
          'Missing note data (tid: missing-note-id) for Project PROJECT_WITH_NOTES',
        );
      });
    });

    describe('inconsistent task project assignments', () => {
      it('should throw error when task appears in multiple project task lists', () => {
        const taskData = fakeEntityStateFromArray<Task>([
          {
            ...DEFAULT_TASK,
            id: 'shared-task',
            projectId: 'project-1',
          },
          {
            ...DEFAULT_TASK,
            id: 'normal-task',
            projectId: 'project-1',
          },
        ]);

        const projectData = fakeEntityStateFromArray<Project>([
          {
            ...DEFAULT_PROJECT,
            id: 'project-1',
            taskIds: ['shared-task', 'normal-task'],
          },
          {
            ...DEFAULT_PROJECT,
            id: 'project-2',
            taskIds: ['shared-task'], // Same task in different project
          },
        ]);

        const invalidData = {
          ...mockAppData,
          task: taskData,
          project: projectData,
        };

        expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
          'Inconsistent task projectId',
        );
      });
    });
  });

  describe('tag validation errors', () => {
    it('should throw error when tag references non-existent task', () => {
      const invalidData = {
        ...mockAppData,
        task: mockAppData.task,
        tag: {
          ...fakeEntityStateFromArray([
            {
              title: 'TEST_TAG',
              id: 'TEST_TAG_ID',
              taskIds: ['missing-task-for-tag'],
            },
          ] as Partial<Tag>[]),
        },
      };

      expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
        'Inconsistent Task State: Missing task id missing-task-for-tag for Tag TEST_TAG',
      );
    });

    // it('should throw error when task references non-existent tag', () => {
    //   const taskData = fakeEntityStateFromArray<Task>([
    //     {
    //       ...DEFAULT_TASK,
    //       id: 'task-with-invalid-tag',
    //       tagIds: ['non-existent-tag'],
    //       projectId: INBOX_PROJECT.id,
    //     },
    //   ]);
    //
    //   const invalidData = {
    //     ...mockAppData,
    //     task: taskData,
    //   };
    //
    //   expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
    //     'tagId "non-existent-tag" from task not existing',
    //   );
    // });

    it('should throw error when archived task references non-existent tag', () => {
      const invalidData = {
        ...mockAppData,
        archiveYoung: {
          lastTimeTrackingFlush: 0,
          timeTracking: mockAppData.archiveYoung.timeTracking,
          task: {
            ...mockAppData.archiveYoung.task,
            ...fakeEntityStateFromArray<Task>([
              {
                ...DEFAULT_TASK,
                id: 'archived-task',
                tagIds: ['non-existent-tag'],
              },
            ]),
          } as any,
        },
      };

      expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
        'tagId "non-existent-tag" from task archive not existing',
      );
    });
  });

  describe('project reference validation', () => {
    it('should throw error when task references non-existent project', () => {
      const taskData = fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'orphaned-task',
          projectId: 'non-existent-project',
        },
      ]);

      const invalidData = {
        ...mockAppData,
        task: taskData,
      };

      expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
        'projectId non-existent-project from task not existing',
      );
    });

    it('should throw error when archived task references non-existent project', () => {
      const invalidData = {
        ...mockAppData,
        archiveYoung: {
          lastTimeTrackingFlush: 0,
          timeTracking: mockAppData.archiveYoung.timeTracking,
          task: {
            ...mockAppData.archiveYoung.task,
            ...fakeEntityStateFromArray<Task>([
              {
                ...DEFAULT_TASK,
                id: 'archived-task',
                projectId: 'non-existent-project',
              },
            ]),
          } as any,
        },
      };

      expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
        'projectId non-existent-project from archive task not existing',
      );
    });

    it('should throw error when issue provider references non-existent project', () => {
      const invalidData = {
        ...mockAppData,
        issueProvider: {
          ...mockAppData.issueProvider,
          ...fakeEntityStateFromArray<IssueProvider>([
            {
              id: 'invalid-provider',
              defaultProjectId: 'non-existent-project',
            },
          ]),
        } as any,
      };

      expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
        'defaultProjectId non-existent-project from issueProvider not existing',
      );
    });
  });

  describe('reminder validation', () => {
    it('should throw error when task references non-existent reminder', () => {
      const taskData = {
        ...mockAppData.task,
        ids: ['task-with-reminder'],
        entities: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'task-with-reminder': {
            ...DEFAULT_TASK,
            id: 'task-with-reminder',
            reminderId: 'missing-reminder-id',
            projectId: INBOX_PROJECT.id,
          },
        },
      };

      const projectData = {
        ...fakeEntityStateFromArray([
          {
            ...DEFAULT_PROJECT,
            title: 'Test Project',
            id: INBOX_PROJECT.id,
            taskIds: ['task-with-reminder'],
          },
        ]),
      };

      const invalidData = {
        ...mockAppData,
        task: taskData,
        project: projectData,
      };

      expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
        'Reminder ID "missing-reminder-id" on task "" of type "undefined" was not found.',
        // 'Missing reminder missing-reminder-id from task not existing',
      );
    });
  });

  describe('sub-task validation', () => {
    it('should throw error for orphaned sub-task in archive without parent', () => {
      const taskData = fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'parent-task',
          parentId: undefined,
          subTaskIds: ['unarchived-subtask'],
          projectId: INBOX_PROJECT.id,
        },
        {
          ...DEFAULT_TASK,
          id: 'unarchived-subtask',
          parentId: 'parent-task',
          projectId: INBOX_PROJECT.id,
        },
      ]);

      const taskArchiveData = fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'orphaned-archived-subtask',
          parentId: 'parent-task', // Parent is not in archive
          projectId: INBOX_PROJECT.id,
        },
      ]);

      const projectData = {
        ...mockAppData.project,
        ...fakeEntityStateFromArray<Project>([
          {
            ...DEFAULT_PROJECT,
            id: INBOX_PROJECT.id,
            taskIds: ['parent-task'],
          },
        ]),
      };

      const invalidData = {
        ...mockAppData,
        task: taskData,
        project: projectData,
        archiveYoung: {
          lastTimeTrackingFlush: 0,
          timeTracking: mockAppData.archiveYoung.timeTracking,
          task: taskArchiveData,
        },
      };

      expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
        'Inconsistent Task State: Lonely Sub Task in Archive orphaned-archived-subtask',
      );
    });

    // it('should throw error for orphaned sub-task in today list without parent', () => {
    //   const taskData = fakeEntityStateFromArray<Task>([
    //     {
    //       ...DEFAULT_TASK,
    //       id: 'orphaned-today-subtask',
    //       parentId: 'missing-parent',
    //       projectId: INBOX_PROJECT.id,
    //     },
    //   ]);
    //
    //   const invalidData = {
    //     ...mockAppData,
    //     task: taskData,
    //   };
    //
    //   expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
    //     'Inconsistent Task State: Lonely Sub Task in Today orphaned-today-subtask',
    //   );
    // });

    it('should not throw error when parent task is in archiveOld and subtask is in archiveYoung', () => {
      const taskData = fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'parent-task',
          subTaskIds: [],
          projectId: INBOX_PROJECT.id,
        },
      ]);

      const archiveYoungTaskData = fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'sub-task-in-young',
          parentId: 'parent-task-in-old', // parent is in archiveOld
          projectId: INBOX_PROJECT.id,
        },
      ]);

      const archiveOldTaskData = fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'parent-task-in-old',
          subTaskIds: ['sub-task-in-young'], // subtask is in archiveYoung
          projectId: INBOX_PROJECT.id,
        },
      ]);

      const projectData = {
        ...mockAppData.project,
        ...fakeEntityStateFromArray<Project>([
          {
            ...DEFAULT_PROJECT,
            id: INBOX_PROJECT.id,
            taskIds: ['parent-task'],
          },
        ]),
      };

      const validData = {
        ...mockAppData,
        task: taskData,
        project: projectData,
        archiveYoung: {
          lastTimeTrackingFlush: 0,
          timeTracking: mockAppData.archiveYoung.timeTracking,
          task: archiveYoungTaskData,
        },
        archiveOld: {
          lastTimeTrackingFlush: 0,
          timeTracking: mockAppData.archiveOld.timeTracking,
          task: archiveOldTaskData,
        },
      };

      // Should not throw error since parent-child relationship spans archives correctly
      expect(() => isRelatedModelDataValid(validData as any)).not.toThrow();
    });

    it('should throw error for missing sub-task data in today list', () => {
      const taskData = fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'parent-with-missing-subtask',
          subTaskIds: ['missing-subtask-id'],
          projectId: INBOX_PROJECT.id,
        },
      ]);

      const projectData = {
        ...mockAppData.project,
        ...fakeEntityStateFromArray<Project>([
          {
            ...DEFAULT_PROJECT,
            id: INBOX_PROJECT.id,
            taskIds: ['parent-with-missing-subtask'],
          },
        ]),
      };

      const invalidData = {
        ...mockAppData,
        task: taskData,
        project: projectData,
      };

      expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
        'Inconsistent Task State: Missing sub task data in today missing-subtask-id',
      );
    });

    // it('should throw error for missing sub-task data in archive', () => {
    //   const taskArchiveData = fakeEntityStateFromArray<Task>([
    //     {
    //       ...DEFAULT_TASK,
    //       id: 'archived-parent-with-missing-subtask',
    //       subTaskIds: ['missing-archived-subtask'],
    //       projectId: INBOX_PROJECT.id,
    //     },
    //   ]);
    //
    //   const invalidData = {
    //     ...mockAppData,
    //     archiveYoung: {
    //       lastTimeTrackingFlush: 0,
    //       timeTracking: mockAppData.archiveYoung.timeTracking,
    //       task: taskArchiveData,
    //     },
    //   };
    //
    //   expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
    //     'Inconsistent Task State: Missing sub task data in archive missing-archived-subtask',
    //   );
    // });
  });

  describe('task without project or tag validation', () => {
    it('should throw error for task without project or tag assignment', () => {
      const taskData = fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'homeless-task',
          parentId: undefined,
          projectId: undefined,
          tagIds: [],
        },
      ]);

      const invalidData = {
        ...mockAppData,
        task: taskData,
      };

      expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
        'Task without project or tag',
      );
    });

    it('should allow task with tag but no project', () => {
      const taskData = fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'tagged-task',
          projectId: undefined,
          tagIds: ['some-tag'],
        },
      ]);

      const tagData = fakeEntityStateFromArray<Tag>([
        {
          id: 'some-tag',
          title: 'Some Tag',
          taskIds: ['tagged-task'],
        },
      ]);

      const validData = {
        ...mockAppData,
        task: taskData,
        tag: tagData,
      };

      expect(() => isRelatedModelDataValid(validData as any)).not.toThrow();
    });
  });

  describe('note validation', () => {
    it('should throw error for inconsistent note todayOrder', () => {
      const noteData = {
        ...mockAppData.note,
        ...fakeEntityStateFromArray<Note>([
          {
            id: 'existing-note',
            content: 'Existing Note Content',
          },
        ]),
        todayOrder: ['missing-note-id'],
      } as any;

      const invalidData = {
        ...mockAppData,
        note: noteData,
      };

      expect(() => isRelatedModelDataValid(invalidData as any)).toThrowError(
        'Inconsistent Note State: Missing note id missing-note-id for note.todayOrder',
      );
    });
  });

  describe('edge cases and boundary conditions', () => {
    it('should handle empty entity states without errors', () => {
      const emptyData = {
        ...mockAppData,
        task: { ids: [], entities: {} },
        project: {
          ids: [INBOX_PROJECT.id],
          entities: { [INBOX_PROJECT.id]: INBOX_PROJECT },
        },
        tag: { ids: [], entities: {} },
        note: { ids: [], entities: {}, todayOrder: [] },
      };

      expect(() => isRelatedModelDataValid(emptyData as any)).not.toThrow();
    });

    // it('should handle null/undefined entity references gracefully', () => {
    //   const taskData = fakeEntityStateFromArray<Task>([
    //     {
    //       ...DEFAULT_TASK,
    //       id: 'task-with-nulls',
    //       projectId: INBOX_PROJECT.id,
    //       parentId: null as any,
    //       subTaskIds: [],
    //       tagIds: [],
    //     },
    //   ]);
    //
    //   const validData = {
    //     ...mockAppData,
    //     task: taskData,
    //   };
    //
    //   expect(() => isRelatedModelDataValid(validData as any)).not.toThrow();
    // });

    it('should validate large datasets efficiently', () => {
      const largeTasks = Array.from({ length: 100 }, (_, i) => ({
        ...DEFAULT_TASK,
        id: `task-${i}`,
        projectId: INBOX_PROJECT.id,
        title: `Task ${i}`,
      }));

      const taskData = fakeEntityStateFromArray<Task>(largeTasks);
      const projectData = {
        ...fakeEntityStateFromArray([
          {
            ...INBOX_PROJECT,
            taskIds: largeTasks.map((t) => t.id),
          },
        ]),
      };

      const largeData = {
        ...mockAppData,
        task: taskData,
        project: projectData,
      };

      const startTime = Date.now();
      expect(() => isRelatedModelDataValid(largeData as any)).not.toThrow();
      const endTime = Date.now();

      // Should complete validation within reasonable time (adjust threshold as needed)
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });

  describe('complex validation scenarios', () => {
    it('should validate complex task hierarchies correctly', () => {
      const complexTaskData = fakeEntityStateFromArray<Task>([
        {
          ...DEFAULT_TASK,
          id: 'parent-1',
          projectId: INBOX_PROJECT.id,
          subTaskIds: ['child-1-1', 'child-1-2'],
        },
        {
          ...DEFAULT_TASK,
          id: 'child-1-1',
          projectId: INBOX_PROJECT.id,
          parentId: 'parent-1',
        },
        {
          ...DEFAULT_TASK,
          id: 'child-1-2',
          projectId: INBOX_PROJECT.id,
          parentId: 'parent-1',
          subTaskIds: ['grandchild-1'],
        },
        {
          ...DEFAULT_TASK,
          id: 'grandchild-1',
          projectId: INBOX_PROJECT.id,
          parentId: 'child-1-2',
        },
      ]);

      const projectData = {
        ...fakeEntityStateFromArray([
          {
            ...INBOX_PROJECT,
            taskIds: ['parent-1'],
          },
        ]),
      };

      const complexData = {
        ...mockAppData,
        task: complexTaskData,
        project: projectData,
      };

      expect(() => isRelatedModelDataValid(complexData as any)).not.toThrow();
    });
  });
});
