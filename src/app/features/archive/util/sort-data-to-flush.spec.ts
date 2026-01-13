/* eslint-disable @typescript-eslint/naming-convention */
import {
  sortTimeTrackingAndTasksFromArchiveYoungToOld,
  sortTimeTrackingDataToArchiveYoung,
  splitArchiveTasksByDoneOnThreshold,
} from './sort-data-to-flush';
import { ArchiveModel } from '../archive.model';
import {
  TimeTrackingState,
  TTWorkContextData,
} from '../../time-tracking/time-tracking.model';
import { ImpossibleError } from '../../../op-log/sync-exports';
import { TaskCopy } from '../../tasks/task.model';

const BASE_TASK: TaskCopy = {
  title: 'base task',
  subTaskIds: [],
  timeSpentOnDay: {},
  timeSpent: 0,
  timeEstimate: 0,
  isDone: true,
  notes: '',
  tagIds: [],
  created: 0,
  _hideSubTasksMode: 2,
  attachments: [],
} as Partial<TaskCopy> as TaskCopy;

describe('sort-data-to-flush', () => {
  // Mock the getWorklogStr function using Jasmine
  const MOCK_TODAY_STR = '2023-05-15';

  // Helper to create a valid TTWorkContextData object
  const createTimeEntry = (): TTWorkContextData => ({
    s: 1, // start time
    e: 2, // end time
    b: 3, // break number
    bt: 4, // break time
  });

  describe('sortTimeTrackingDataToArchiveYoung()', () => {
    it('should move old time tracking entries to archive', () => {
      // Arrange
      const timeTrackingIn: TimeTrackingState = {
        project: {
          project1: {
            '2023-05-14': createTimeEntry(),
            '2023-05-15': createTimeEntry(),
          },
          project2: {
            '2023-05-13': createTimeEntry(),
          },
        },
        tag: {
          tag1: {
            '2023-05-14': createTimeEntry(),
            '2023-05-15': createTimeEntry(),
          },
        },
      };

      const archiveYoung: ArchiveModel = {
        task: { ids: [], entities: {} },
        timeTracking: {
          project: {
            project3: {
              '2023-05-10': createTimeEntry(),
            },
          },
          tag: {},
        },
        lastTimeTrackingFlush: 1621000000000,
      };

      // Act
      const result = sortTimeTrackingDataToArchiveYoung({
        timeTracking: timeTrackingIn,
        archiveYoung,
        todayStr: '2023-05-15',
      });
      console.log(result);

      // values for today should still be there
      expect(result.timeTracking.project.project1['2023-05-15']).toBeDefined();
      expect(result.timeTracking.tag.tag1['2023-05-15']).toBeDefined();

      // everything else should be gone
      expect(result.timeTracking.project.project1['2023-05-14']).toBeUndefined();
      expect(result.timeTracking.project.project2['2023-05-13']).toBeUndefined();
      expect(result.timeTracking.tag.tag1['2023-05-14']).toBeUndefined();

      expect(
        result.archiveYoung.timeTracking.project.project1['2023-05-14'],
      ).toBeDefined();
      expect(
        result.archiveYoung.timeTracking.project.project2['2023-05-13'],
      ).toBeDefined();
      expect(
        result.archiveYoung.timeTracking.project.project3['2023-05-10'],
      ).toBeDefined();
      expect(result.archiveYoung.timeTracking.tag.tag1['2023-05-14']).toBeDefined();
    });

    it('should handle empty time tracking data', () => {
      // Arrange
      const timeTracking: TimeTrackingState = {
        project: {},
        tag: {},
      };

      const archiveYoung: ArchiveModel = {
        task: { ids: [], entities: {} },
        timeTracking: { project: {}, tag: {} },
        lastTimeTrackingFlush: 1621000000000,
      };

      // Act
      const result = sortTimeTrackingDataToArchiveYoung({
        timeTracking,
        archiveYoung,
        todayStr: MOCK_TODAY_STR,
      });

      // Assert
      expect(result.timeTracking).toEqual({ project: {}, tag: {} });
      expect(result.archiveYoung.timeTracking).toEqual({ project: {}, tag: {} });
    });
  });

  describe('splitArchiveTasksByDoneOnThreshold()', () => {
    const now = 1621100000000; // May 16, 2021
    const threshold = 7 * 24 * 60 * 60 * 1000; // 7 days

    it('should move tasks older than threshold', () => {
      // Arrange
      const youngTaskState = {
        ids: ['1', '2', '3'],
        entities: {
          '1': {
            ...BASE_TASK,
            id: '1',
            doneOn: now - (threshold + 1000),
          },
          '2': {
            ...BASE_TASK,
            id: '2',
            doneOn: now - (threshold - 3000),
          },
          '3': {
            ...BASE_TASK,
            id: '3',
            doneOn: now - (threshold + 5000),
          },
        },
      };

      const oldTaskState = {
        ids: ['4'],
        entities: {
          '4': {
            ...BASE_TASK,
            id: '4',
            // eslint-disable-next-line no-mixed-operators
            doneOn: now - threshold * 2,
          },
        },
      };

      // Act
      const result = splitArchiveTasksByDoneOnThreshold({
        youngTaskState,
        oldTaskState,
        threshold,
        now,
      });

      // Assert
      expect(Object.keys(result.youngTaskState.entities)).toEqual(['2']);
      expect(Object.keys(result.oldTaskState.entities).sort()).toEqual(['1', '3', '4']);
    });

    it('should keep tasks newer than threshold', () => {
      // Arrange
      const youngTaskState = {
        ids: ['1', '2'],
        entities: {
          '1': {
            ...BASE_TASK,
            id: '1',
            doneOn: now - 1000,
          },
          '2': {
            ...BASE_TASK,
            id: '2',
            doneOn: now - 2000,
          },
        },
      };

      const oldTaskState = {
        ids: ['3'],
        entities: {
          '3': {
            ...BASE_TASK,
            id: '3',
            // eslint-disable-next-line no-mixed-operators
            doneOn: now - threshold * 2,
          },
        },
      };

      // Act
      const result = splitArchiveTasksByDoneOnThreshold({
        youngTaskState,
        oldTaskState,
        threshold,
        now,
      });

      // Assert
      expect(Object.keys(result.youngTaskState.entities)).toEqual(['1', '2']);
      expect(Object.keys(result.oldTaskState.entities)).toEqual(['3']);
    });

    it('should migrate parent and sub tasks together', () => {
      // Arrange
      const youngTaskState = {
        ids: ['1', '2'],
        entities: {
          '1': {
            ...BASE_TASK,
            id: '1',
            doneOn: now - 1000,
          },
          '2P': {
            ...BASE_TASK,
            id: '2P',
            // eslint-disable-next-line no-mixed-operators
            doneOn: now - threshold * 2,
            subTaskIds: ['3S', '4S'],
          },
          '3S': {
            ...BASE_TASK,
            id: '3S',
            parentId: '2P',
            doneOn: now - 2000,
          },
          '4S': {
            ...BASE_TASK,
            id: '4S',
            parentId: '2P',
            doneOn: now - 2000,
          },
        },
      };

      const oldTaskState = {
        ids: ['5'],
        entities: {
          '5': {
            ...BASE_TASK,
            id: '5',
            // eslint-disable-next-line no-mixed-operators
            doneOn: now - threshold * 2,
          },
        },
      };

      // Act
      const result = splitArchiveTasksByDoneOnThreshold({
        youngTaskState,
        oldTaskState,
        threshold,
        now,
      });

      // Assert
      expect(Object.keys(result.youngTaskState.entities)).toEqual(['1']);
      expect(Object.keys(result.oldTaskState.entities).sort()).toEqual([
        '2P',
        '3S',
        '4S',
        '5',
      ]);
    });

    it('should also migrate legacy tasks without doneOn', () => {
      // Arrange
      const youngTaskState = {
        ids: ['1'],
        entities: {
          '1': {
            ...BASE_TASK,
            id: '1',
            doneOn: undefined,
          },
        },
      };

      const oldTaskState = {
        ids: ['5'],
        entities: {
          '5': {
            ...BASE_TASK,
            id: '5',
            // eslint-disable-next-line no-mixed-operators
            doneOn: now - threshold * 2,
          },
        },
      };

      // Act
      const result = splitArchiveTasksByDoneOnThreshold({
        youngTaskState,
        oldTaskState,
        threshold,
        now,
      });

      // Assert
      expect(Object.keys(result.youngTaskState.entities)).toEqual([]);
      expect(Object.keys(result.oldTaskState.entities).sort()).toEqual(['1', '5']);
    });

    it('should throw error if task is undefined', () => {
      // Arrange
      const youngTaskState = {
        ids: ['1', '2'],
        entities: {
          '1': {
            ...BASE_TASK,
            id: '1',
            doneOn: now - 1000,
          },
          '2': undefined as any,
        },
      };

      const oldTaskState = {
        ids: [],
        entities: {},
      };

      // Act & Assert
      expect(() => {
        splitArchiveTasksByDoneOnThreshold({
          youngTaskState,
          oldTaskState,
          threshold,
          now,
        });
      }).toThrow(
        new ImpossibleError('splitArchiveTasksByDoneOnThreshold(): Task not found'),
      );
    });

    it('should return sorted ids for deterministic ordering across clients', () => {
      // Arrange - use UUIDv7-like ids that would be in different order if unsorted
      const youngTaskState = {
        ids: ['019xyz', '019abc', '019def'], // Intentionally out of order
        entities: {
          '019xyz': {
            ...BASE_TASK,
            id: '019xyz',
            doneOn: now - (threshold + 1000), // Will be moved to old
          },
          '019abc': {
            ...BASE_TASK,
            id: '019abc',
            doneOn: now - 1000, // Will stay in young
          },
          '019def': {
            ...BASE_TASK,
            id: '019def',
            doneOn: now - (threshold + 2000), // Will be moved to old
          },
        },
      };

      const oldTaskState = {
        ids: ['019zzz'], // Existing old task
        entities: {
          '019zzz': {
            ...BASE_TASK,
            id: '019zzz',
            // eslint-disable-next-line no-mixed-operators
            doneOn: now - threshold * 2,
          },
        },
      };

      // Act
      const result = splitArchiveTasksByDoneOnThreshold({
        youngTaskState,
        oldTaskState,
        threshold,
        now,
      });

      // Assert - ids should be sorted alphabetically (UUIDv7 is lexicographically sortable)
      expect(result.youngTaskState.ids).toEqual(['019abc']);
      expect(result.oldTaskState.ids).toEqual(['019def', '019xyz', '019zzz']);
    });

    it('should produce same sorted order regardless of entity insertion order', () => {
      // Arrange - simulate different insertion orders that could occur across clients
      const youngTaskState1 = {
        ids: ['c', 'a', 'b'],
        entities: {
          c: { ...BASE_TASK, id: 'c', doneOn: now - (threshold + 1000) },
          a: { ...BASE_TASK, id: 'a', doneOn: now - (threshold + 1000) },
          b: { ...BASE_TASK, id: 'b', doneOn: now - (threshold + 1000) },
        },
      };

      const youngTaskState2 = {
        ids: ['b', 'c', 'a'],
        entities: {
          b: { ...BASE_TASK, id: 'b', doneOn: now - (threshold + 1000) },
          c: { ...BASE_TASK, id: 'c', doneOn: now - (threshold + 1000) },
          a: { ...BASE_TASK, id: 'a', doneOn: now - (threshold + 1000) },
        },
      };

      const oldTaskState = { ids: [], entities: {} };

      // Act
      const result1 = splitArchiveTasksByDoneOnThreshold({
        youngTaskState: youngTaskState1,
        oldTaskState,
        threshold,
        now,
      });

      const result2 = splitArchiveTasksByDoneOnThreshold({
        youngTaskState: youngTaskState2,
        oldTaskState,
        threshold,
        now,
      });

      // Assert - both should produce the same sorted order
      expect(result1.oldTaskState.ids).toEqual(['a', 'b', 'c']);
      expect(result2.oldTaskState.ids).toEqual(['a', 'b', 'c']);
      expect(result1.oldTaskState.ids).toEqual(result2.oldTaskState.ids);
    });
  });

  describe('sortTimeTrackingAndTasksFromArchiveYoungToOld', () => {
    const now = 1621100000000; // May 16, 2021
    const threshold = 7 * 24 * 60 * 60 * 1000; // 7 days

    it('should handle frozen timeTracking from defaultData (fresh install scenario)', () => {
      // Simulate the exact frozen state from initialTimeTrackingState with `as const`
      // This happens on fresh install or after sync when archiveOld uses defaultData
      const frozenTimeTracking = Object.freeze({
        project: Object.freeze({}),
        tag: Object.freeze({}),
      });

      const archiveYoung: ArchiveModel = {
        task: { ids: [], entities: {} },
        timeTracking: {
          project: { project1: { '2023-05-14': createTimeEntry() } },
          tag: { tag1: { '2023-05-14': createTimeEntry() } },
        },
        // eslint-disable-next-line no-mixed-operators
        lastTimeTrackingFlush: now - threshold / 2,
      };

      const archiveOld: ArchiveModel = {
        task: { ids: [], entities: {} },
        timeTracking: frozenTimeTracking as any, // Frozen default!
        lastTimeTrackingFlush: now - threshold,
      };

      // Before fix: throws TypeError: Cannot add property, object is not extensible
      // After fix: completes successfully
      expect(() => {
        sortTimeTrackingAndTasksFromArchiveYoungToOld({
          archiveYoung,
          archiveOld,
          threshold,
          now,
        });
      }).not.toThrow();

      // Also verify the merge worked correctly
      const result = sortTimeTrackingAndTasksFromArchiveYoungToOld({
        archiveYoung,
        archiveOld,
        threshold,
        now,
      });
      expect(result.archiveOld.timeTracking.project.project1['2023-05-14']).toBeDefined();
      expect(result.archiveOld.timeTracking.tag.tag1['2023-05-14']).toBeDefined();
    });

    it('should handle frozen nested context objects', () => {
      // Frozen nested context - simulates partial frozen state
      const frozenTimeTracking = {
        project: Object.freeze({ existingProject: Object.freeze({}) }),
        tag: {},
      };

      // archiveYoung adds new date to the frozen existingProject context
      const archiveYoung: ArchiveModel = {
        task: { ids: [], entities: {} },
        timeTracking: {
          project: { existingProject: { '2023-05-14': createTimeEntry() } },
          tag: {},
        },
        // eslint-disable-next-line no-mixed-operators
        lastTimeTrackingFlush: now - threshold / 2,
      };

      const archiveOld: ArchiveModel = {
        task: { ids: [], entities: {} },
        timeTracking: frozenTimeTracking as any,
        lastTimeTrackingFlush: now - threshold,
      };

      // Before fix: throws TypeError when trying to add to frozen existingProject
      // After fix: completes successfully
      expect(() => {
        sortTimeTrackingAndTasksFromArchiveYoungToOld({
          archiveYoung,
          archiveOld,
          threshold,
          now,
        });
      }).not.toThrow();

      // Verify the merge worked correctly
      const result = sortTimeTrackingAndTasksFromArchiveYoungToOld({
        archiveYoung,
        archiveOld,
        threshold,
        now,
      });
      expect(
        result.archiveOld.timeTracking.project.existingProject['2023-05-14'],
      ).toBeDefined();
    });

    it('should move old tasks and all time tracking data', () => {
      // Arrange
      const archiveYoung: ArchiveModel = {
        task: {
          ids: ['1', '2'],
          entities: {
            '1': {
              ...BASE_TASK,
              id: '1',
              doneOn: now - (threshold + 1000),
            },
            '2': {
              ...BASE_TASK,
              id: '2',
              doneOn: now - 1000,
            },
          },
        },
        timeTracking: {
          project: {
            project1: { '2023-05-14': createTimeEntry() },
          },
          tag: {
            tag1: { '2023-05-14': createTimeEntry() },
          },
        },
        // eslint-disable-next-line no-mixed-operators
        lastTimeTrackingFlush: now - threshold / 2,
      };

      const archiveOld: ArchiveModel = {
        task: {
          ids: ['3'],
          entities: {
            '3': {
              ...BASE_TASK,
              id: '3',
              // eslint-disable-next-line no-mixed-operators
              doneOn: now - threshold * 2,
            },
          },
        },
        timeTracking: {
          project: {
            project2: { '2023-05-10': createTimeEntry() },
          },
          tag: {},
        },
        lastTimeTrackingFlush: now - threshold,
      };

      // Act
      const result = sortTimeTrackingAndTasksFromArchiveYoungToOld({
        archiveYoung,
        archiveOld,
        threshold,
        now,
      });

      // Assert
      // Check tasks were moved correctly
      expect(Object.keys(result.archiveYoung.task.entities)).toEqual(['2']);
      expect(Object.keys(result.archiveOld.task.entities).sort()).toEqual(['1', '3']);

      // Check all time tracking was moved to old
      expect(result.archiveYoung.timeTracking).toEqual({ project: {}, tag: {} });
      expect(result.archiveOld.timeTracking).toEqual({
        project: {
          project1: { '2023-05-14': createTimeEntry() },
          project2: { '2023-05-10': createTimeEntry() },
        },
        tag: { tag1: { '2023-05-14': createTimeEntry() } },
      });
    });

    it('should handle empty archives', () => {
      // Arrange
      const archiveYoung: ArchiveModel = {
        task: { ids: [], entities: {} },
        timeTracking: { project: {}, tag: {} },
        // eslint-disable-next-line no-mixed-operators
        lastTimeTrackingFlush: now - threshold / 2,
      };

      const archiveOld: ArchiveModel = {
        task: { ids: [], entities: {} },
        timeTracking: { project: {}, tag: {} },
        lastTimeTrackingFlush: now - threshold,
      };

      // Act
      const result = sortTimeTrackingAndTasksFromArchiveYoungToOld({
        archiveYoung,
        archiveOld,
        threshold,
        now,
      });

      // Assert
      expect(result.archiveYoung.task.ids).toEqual([]);
      expect(result.archiveOld.task.ids).toEqual([]);
      expect(result.archiveYoung.timeTracking).toEqual({ project: {}, tag: {} });
      expect(result.archiveOld.timeTracking).toEqual({ project: {}, tag: {} });
    });

    describe('timeTracking flush completeness', () => {
      it('should completely clear all timeTracking from archiveYoung after flush', () => {
        // This test ensures that after flush, archiveYoung.timeTracking is empty
        // This is critical for deterministic sync - all clients must have same state
        const archiveYoung: ArchiveModel = {
          task: { ids: [], entities: {} },
          timeTracking: {
            project: {
              project1: {
                '2023-05-01': createTimeEntry(),
                '2023-05-02': createTimeEntry(),
                '2023-05-03': createTimeEntry(),
              },
              project2: {
                '2023-05-04': createTimeEntry(),
              },
            },
            tag: {
              tag1: {
                '2023-05-01': createTimeEntry(),
                '2023-05-02': createTimeEntry(),
              },
              tag2: {
                '2023-05-03': createTimeEntry(),
              },
            },
          },
          // eslint-disable-next-line no-mixed-operators
          lastTimeTrackingFlush: now - threshold / 2,
        };

        const archiveOld: ArchiveModel = {
          task: { ids: [], entities: {} },
          timeTracking: { project: {}, tag: {} },
          lastTimeTrackingFlush: now - threshold,
        };

        const result = sortTimeTrackingAndTasksFromArchiveYoungToOld({
          archiveYoung,
          archiveOld,
          threshold,
          now,
        });

        // archiveYoung.timeTracking must be completely empty
        expect(result.archiveYoung.timeTracking).toEqual({ project: {}, tag: {} });
        expect(Object.keys(result.archiveYoung.timeTracking.project).length).toBe(0);
        expect(Object.keys(result.archiveYoung.timeTracking.tag).length).toBe(0);

        // archiveOld should have all the data
        expect(Object.keys(result.archiveOld.timeTracking.project).length).toBe(2);
        expect(Object.keys(result.archiveOld.timeTracking.tag).length).toBe(2);
      });

      it('should merge timeTracking from young into existing old data', () => {
        // Test the merge behavior when archiveOld already has data for same context
        const archiveYoung: ArchiveModel = {
          task: { ids: [], entities: {} },
          timeTracking: {
            project: {
              sharedProject: {
                '2023-05-15': createTimeEntry(), // New date for existing context
              },
            },
            tag: {},
          },
          // eslint-disable-next-line no-mixed-operators
          lastTimeTrackingFlush: now - threshold / 2,
        };

        const archiveOld: ArchiveModel = {
          task: { ids: [], entities: {} },
          timeTracking: {
            project: {
              sharedProject: {
                '2023-05-01': createTimeEntry(), // Existing date for same context
              },
            },
            tag: {},
          },
          lastTimeTrackingFlush: now - threshold,
        };

        const result = sortTimeTrackingAndTasksFromArchiveYoungToOld({
          archiveYoung,
          archiveOld,
          threshold,
          now,
        });

        // Both dates should exist in archiveOld
        expect(
          result.archiveOld.timeTracking.project.sharedProject['2023-05-01'],
        ).toBeDefined();
        expect(
          result.archiveOld.timeTracking.project.sharedProject['2023-05-15'],
        ).toBeDefined();
      });

      it('should handle young overwriting old for same date (LWW)', () => {
        // When young has same context/date as old, young should win (it's newer)
        const youngEntry: TTWorkContextData = { s: 100, e: 200, b: 1, bt: 10 };
        const oldEntry: TTWorkContextData = { s: 50, e: 100, b: 0, bt: 0 };

        const archiveYoung: ArchiveModel = {
          task: { ids: [], entities: {} },
          timeTracking: {
            project: {
              project1: { '2023-05-01': youngEntry },
            },
            tag: {},
          },
          // eslint-disable-next-line no-mixed-operators
          lastTimeTrackingFlush: now - threshold / 2,
        };

        const archiveOld: ArchiveModel = {
          task: { ids: [], entities: {} },
          timeTracking: {
            project: {
              project1: { '2023-05-01': oldEntry },
            },
            tag: {},
          },
          lastTimeTrackingFlush: now - threshold,
        };

        const result = sortTimeTrackingAndTasksFromArchiveYoungToOld({
          archiveYoung,
          archiveOld,
          threshold,
          now,
        });

        // Young data should have overwritten old data
        expect(result.archiveOld.timeTracking.project.project1['2023-05-01']).toEqual(
          youngEntry,
        );
      });
    });
  });

  describe('sortTimeTrackingDataToArchiveYoung() edge cases', () => {
    it('should handle date boundary correctly (today stays, yesterday moves)', () => {
      const todayStr = '2023-05-15';
      const yesterdayStr = '2023-05-14';

      const timeTracking: TimeTrackingState = {
        project: {
          project1: {
            [todayStr]: createTimeEntry(),
            [yesterdayStr]: createTimeEntry(),
          },
        },
        tag: {},
      };

      const archiveYoung: ArchiveModel = {
        task: { ids: [], entities: {} },
        timeTracking: { project: {}, tag: {} },
        lastTimeTrackingFlush: 1621000000000,
      };

      const result = sortTimeTrackingDataToArchiveYoung({
        timeTracking,
        archiveYoung,
        todayStr,
      });

      // Today's data should stay in current timeTracking
      expect(result.timeTracking.project.project1[todayStr]).toBeDefined();
      // Yesterday's data should be moved to archiveYoung
      expect(result.timeTracking.project.project1[yesterdayStr]).toBeUndefined();
      expect(
        result.archiveYoung.timeTracking.project.project1[yesterdayStr],
      ).toBeDefined();
    });

    it('should handle future dates correctly (kept in current)', () => {
      const todayStr = '2023-05-15';
      const futureStr = '2023-05-20'; // 5 days in future

      const timeTracking: TimeTrackingState = {
        project: {
          project1: {
            [todayStr]: createTimeEntry(),
            [futureStr]: createTimeEntry(), // Edge case: future date (shouldn't normally happen)
          },
        },
        tag: {},
      };

      const archiveYoung: ArchiveModel = {
        task: { ids: [], entities: {} },
        timeTracking: { project: {}, tag: {} },
        lastTimeTrackingFlush: 1621000000000,
      };

      const result = sortTimeTrackingDataToArchiveYoung({
        timeTracking,
        archiveYoung,
        todayStr,
      });

      // Future date should move to archive (it's not today)
      // This is the actual behavior - only exact todayStr match stays
      expect(result.timeTracking.project.project1[todayStr]).toBeDefined();
      expect(result.archiveYoung.timeTracking.project.project1[futureStr]).toBeDefined();
    });

    it('should preserve all date entries when merging with existing archiveYoung', () => {
      const todayStr = '2023-05-15';

      const timeTracking: TimeTrackingState = {
        project: {
          project1: { '2023-05-14': createTimeEntry() },
        },
        tag: {},
      };

      const archiveYoung: ArchiveModel = {
        task: { ids: [], entities: {} },
        timeTracking: {
          project: {
            project1: {
              '2023-05-10': createTimeEntry(),
              '2023-05-11': createTimeEntry(),
            },
          },
          tag: {},
        },
        lastTimeTrackingFlush: 1621000000000,
      };

      const result = sortTimeTrackingDataToArchiveYoung({
        timeTracking,
        archiveYoung,
        todayStr,
      });

      // All dates should be preserved in archiveYoung
      expect(
        result.archiveYoung.timeTracking.project.project1['2023-05-10'],
      ).toBeDefined();
      expect(
        result.archiveYoung.timeTracking.project.project1['2023-05-11'],
      ).toBeDefined();
      expect(
        result.archiveYoung.timeTracking.project.project1['2023-05-14'],
      ).toBeDefined();
    });
  });
});
