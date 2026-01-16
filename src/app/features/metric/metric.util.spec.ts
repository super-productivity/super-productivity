/* eslint-disable @typescript-eslint/naming-convention */
import { mapSimpleMetrics } from './metric.util';
import { Worklog } from '../worklog/worklog.model';
import { Task } from '../tasks/task.model';
import { BreakNr, BreakTime } from '../work-context/work-context.model';
import { createTask } from '../tasks/task.test-helper';
import { getDbDateStr } from '../../util/get-db-date-str';

describe('metric.util', () => {
  describe('mapSimpleMetrics', () => {
    const DAY_2025_01_15 = '2025-01-15';
    const TIMESTAMP_2025_01_15 = new Date('2025-01-15').getTime();
    const TIMESTAMP_2025_01_14 = new Date('2025-01-14').getTime();

    // Helper to create worklog with specific data
    const createWorklog = (
      years: {
        year: number;
        months: {
          month: number;
          days: { day: number; timeSpent: number }[];
        }[];
      }[],
    ): Worklog => {
      const worklog: Worklog = {};

      years.forEach(({ year, months }) => {
        worklog[year] = {
          timeSpent: 0,
          daysWorked: 0,
          monthWorked: 0,
          ent: {},
        };

        months.forEach(({ month, days }) => {
          worklog[year].ent[month] = {
            timeSpent: 0,
            daysWorked: days.length,
            weeks: [],
            ent: {},
          };

          days.forEach(({ day, timeSpent }) => {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            worklog[year].ent[month].ent[day] = {
              timeSpent,
              logEntries: [],
              dateStr,
              dayStr: dateStr, // Required by WorklogDay
              workStart: Date.now(),
              workEnd: Date.now(),
            };
            worklog[year].ent[month].timeSpent += timeSpent;
          });

          worklog[year].timeSpent += worklog[year].ent[month].timeSpent;
          worklog[year].daysWorked += days.length;
        });
      });

      return worklog;
    };

    describe('Basic calculations', () => {
      it('should calculate time metrics correctly', () => {
        const tasks: Task[] = [createTask({ id: '1', timeSpent: 5000, isDone: true })];
        const breakNr: BreakNr = { [DAY_2025_01_15]: 2 };
        const breakTime: BreakTime = { [DAY_2025_01_15]: 600000 }; // 10 minutes
        const worklog = createWorklog([
          { year: 2025, months: [{ month: 1, days: [{ day: 15, timeSpent: 10000 }] }] },
        ]);
        const totalTimeSpent = 10000;

        const result = mapSimpleMetrics([
          breakNr,
          breakTime,
          worklog,
          totalTimeSpent,
          tasks,
        ]);

        expect(result.timeSpent).toBe(10000);
        expect(result.breakNr).toBe(2);
        expect(result.breakTime).toBe(600000);
      });

      it('should count task types correctly (main, sub, parent)', () => {
        const tasks: Task[] = [
          createTask({ id: '1', subTaskIds: ['2', '3'], isDone: true }),
          createTask({ id: '2', parentId: '1', isDone: false }),
          createTask({ id: '3', parentId: '1', isDone: true }),
          createTask({ id: '4', isDone: false }),
        ];
        const breakNr: BreakNr = {};
        const breakTime: BreakTime = {};
        const worklog = createWorklog([
          { year: 2025, months: [{ month: 1, days: [{ day: 15, timeSpent: 1000 }] }] },
        ]);

        const result = mapSimpleMetrics([breakNr, breakTime, worklog, 1000, tasks]);

        expect(result.nrOfAllTasks).toBe(4);
        expect(result.nrOfSubTasks).toBe(2); // Tasks 2 and 3
        expect(result.nrOfMainTasks).toBe(2); // Tasks 1 and 4
        expect(result.nrOfParentTasks).toBe(1); // Task 1 has subtasks
        expect(result.nrOfCompletedTasks).toBe(2); // Tasks 1 and 3
      });

      it('should calculate averages correctly', () => {
        const tasks: Task[] = [createTask({ id: '1' }), createTask({ id: '2' })];
        const breakNr: BreakNr = {
          '2025-01-15': 2,
          '2025-01-16': 3,
        };
        const breakTime: BreakTime = {
          '2025-01-15': 600000,
          '2025-01-16': 900000,
        };
        const worklog = createWorklog([
          {
            year: 2025,
            months: [
              {
                month: 1,
                days: [
                  { day: 15, timeSpent: 10000 },
                  { day: 16, timeSpent: 15000 },
                ],
              },
            ],
          },
        ]);
        const totalTimeSpent = 25000;

        const result = mapSimpleMetrics([
          breakNr,
          breakTime,
          worklog,
          totalTimeSpent,
          tasks,
        ]);

        expect(result.daysWorked).toBe(2);
        expect(result.avgTasksPerDay).toBe(1); // 2 main tasks / 2 days
        expect(result.avgTimeSpentOnDay).toBe(12500); // 25000 / 2
        expect(result.avgTimeSpentOnTask).toBe(12500); // 25000 / 2 main tasks
        expect(result.avgBreakNr).toBe(2.5); // 5 breaks / 2 days
        expect(result.avgBreakTime).toBe(750000); // 1500000ms / 2 days
      });

      it('should find earliest task creation date as start', () => {
        const tasks: Task[] = [
          createTask({ id: '1', created: TIMESTAMP_2025_01_15 }),
          createTask({ id: '2', created: TIMESTAMP_2025_01_14 }),
          createTask({ id: '3', created: TIMESTAMP_2025_01_15 + 1000 }),
        ];
        const breakNr: BreakNr = {};
        const breakTime: BreakTime = {};
        const worklog = createWorklog([
          { year: 2025, months: [{ month: 1, days: [{ day: 15, timeSpent: 1000 }] }] },
        ]);

        const result = mapSimpleMetrics([breakNr, breakTime, worklog, 1000, tasks]);

        expect(result.start).toBe(getDbDateStr(TIMESTAMP_2025_01_14));
      });

      it('should count completed vs total tasks', () => {
        const tasks: Task[] = [
          createTask({ id: '1', isDone: true }),
          createTask({ id: '2', isDone: false }),
          createTask({ id: '3', isDone: true }),
          createTask({ id: '4', isDone: true }),
        ];
        const breakNr: BreakNr = {};
        const breakTime: BreakTime = {};
        const worklog = createWorklog([
          { year: 2025, months: [{ month: 1, days: [{ day: 15, timeSpent: 1000 }] }] },
        ]);

        const result = mapSimpleMetrics([breakNr, breakTime, worklog, 1000, tasks]);

        expect(result.nrOfCompletedTasks).toBe(3);
        expect(result.nrOfAllTasks).toBe(4);
      });

      it('should calculate daysWorked from worklog structure', () => {
        const tasks: Task[] = [createTask()];
        const breakNr: BreakNr = {};
        const breakTime: BreakTime = {};
        const worklog = createWorklog([
          {
            year: 2025,
            months: [
              {
                month: 1,
                days: [
                  { day: 15, timeSpent: 1000 },
                  { day: 16, timeSpent: 2000 },
                  { day: 17, timeSpent: 3000 },
                ],
              },
            ],
          },
          {
            year: 2024,
            months: [
              {
                month: 12,
                days: [
                  { day: 30, timeSpent: 1000 },
                  { day: 31, timeSpent: 2000 },
                ],
              },
            ],
          },
        ]);

        const result = mapSimpleMetrics([breakNr, breakTime, worklog, 9000, tasks]);

        expect(result.daysWorked).toBe(5); // 3 days in 2025-01 + 2 days in 2024-12
      });

      it('should only count timeEstimate for main tasks (not subtasks)', () => {
        const tasks: Task[] = [
          createTask({ id: '1', timeEstimate: 5000 }),
          createTask({ id: '2', parentId: '1', timeEstimate: 3000 }), // subtask
          createTask({ id: '3', timeEstimate: 8000 }),
        ];
        const breakNr: BreakNr = {};
        const breakTime: BreakTime = {};
        const worklog = createWorklog([
          { year: 2025, months: [{ month: 1, days: [{ day: 15, timeSpent: 1000 }] }] },
        ]);

        const result = mapSimpleMetrics([breakNr, breakTime, worklog, 1000, tasks]);

        expect(result.timeEstimate).toBe(13000); // Only main tasks: 5000 + 8000
      });
    });

    describe('Edge cases', () => {
      it('should handle empty task list', () => {
        const tasks: Task[] = [];
        const breakNr: BreakNr = {};
        const breakTime: BreakTime = {};
        const worklog = createWorklog([
          { year: 2025, months: [{ month: 1, days: [{ day: 15, timeSpent: 1000 }] }] },
        ]);

        const result = mapSimpleMetrics([breakNr, breakTime, worklog, 1000, tasks]);

        expect(result.nrOfAllTasks).toBe(0);
        expect(result.nrOfCompletedTasks).toBe(0);
        expect(result.nrOfMainTasks).toBe(0);
        expect(result.nrOfSubTasks).toBe(0);
        expect(result.nrOfParentTasks).toBe(0);
        expect(result.timeEstimate).toBe(0);
        expect(result.start).toBe(getDbDateStr(999999999999999)); // Default max value
      });

      it('should handle tasks with no time spent', () => {
        const tasks: Task[] = [
          createTask({ id: '1', timeSpent: 0 }),
          createTask({ id: '2', timeSpent: 0 }),
        ];
        const breakNr: BreakNr = {};
        const breakTime: BreakTime = {};
        const worklog = createWorklog([
          { year: 2025, months: [{ month: 1, days: [{ day: 15, timeSpent: 0 }] }] },
        ]);

        const result = mapSimpleMetrics([breakNr, breakTime, worklog, 0, tasks]);

        expect(result.timeSpent).toBe(0);
        expect(result.avgTimeSpentOnDay).toBe(0);
        expect(result.avgTimeSpentOnTask).toBe(0);
      });

      it('should handle worklog with zero daysWorked (divide by zero)', () => {
        const tasks: Task[] = [createTask()];
        const breakNr: BreakNr = { [DAY_2025_01_15]: 5 };
        const breakTime: BreakTime = { [DAY_2025_01_15]: 1000000 };
        const worklog: Worklog = {}; // Empty worklog = 0 daysWorked

        const result = mapSimpleMetrics([breakNr, breakTime, worklog, 0, tasks]);

        expect(result.daysWorked).toBe(0);
        // Dividing by zero results in Infinity (1 mainTask / 0 days = Infinity)
        expect(result.avgTasksPerDay).toBe(Infinity);
        // Dividing 0 by 0 results in NaN (0 timeSpent / 0 days)
        expect(result.avgTimeSpentOnDay).toBeNaN();
        expect(result.avgBreakNr).toBe(Infinity); // 5 breaks / 0 days
        expect(result.avgBreakTime).toBe(Infinity); // 1000000ms / 0 days
      });

      it('should handle tasks with undefined subTaskIds', () => {
        const tasks: Task[] = [
          createTask({ id: '1', subTaskIds: undefined as any }),
          createTask({ id: '2', subTaskIds: [] }),
        ];
        const breakNr: BreakNr = {};
        const breakTime: BreakTime = {};
        const worklog = createWorklog([
          { year: 2025, months: [{ month: 1, days: [{ day: 15, timeSpent: 1000 }] }] },
        ]);

        const result = mapSimpleMetrics([breakNr, breakTime, worklog, 1000, tasks]);

        expect(result.nrOfParentTasks).toBe(0);
        expect(result.nrOfMainTasks).toBe(2);
      });

      it('should handle mixed completed and incomplete tasks', () => {
        const tasks: Task[] = [
          createTask({ id: '1', isDone: true }),
          createTask({ id: '2', isDone: false }),
          createTask({ id: '3', isDone: true }),
          createTask({ id: '4', isDone: false }),
          createTask({ id: '5', isDone: true }),
        ];
        const breakNr: BreakNr = {};
        const breakTime: BreakTime = {};
        const worklog = createWorklog([
          { year: 2025, months: [{ month: 1, days: [{ day: 15, timeSpent: 1000 }] }] },
        ]);

        const result = mapSimpleMetrics([breakNr, breakTime, worklog, 1000, tasks]);

        expect(result.nrOfCompletedTasks).toBe(3);
        expect(result.nrOfAllTasks).toBe(5);
      });

      it('should handle tasks with parent-child relationships', () => {
        const tasks: Task[] = [
          createTask({
            id: '1',
            subTaskIds: ['2', '3'],
            isDone: true,
          }),
          createTask({ id: '2', parentId: '1', isDone: true }),
          createTask({ id: '3', parentId: '1', isDone: false }),
          createTask({
            id: '4',
            subTaskIds: ['5'],
            isDone: false,
          }),
          createTask({ id: '5', parentId: '4', isDone: true }),
        ];
        const breakNr: BreakNr = {};
        const breakTime: BreakTime = {};
        const worklog = createWorklog([
          { year: 2025, months: [{ month: 1, days: [{ day: 15, timeSpent: 1000 }] }] },
        ]);

        const result = mapSimpleMetrics([breakNr, breakTime, worklog, 1000, tasks]);

        expect(result.nrOfAllTasks).toBe(5);
        expect(result.nrOfMainTasks).toBe(2); // Tasks 1 and 4
        expect(result.nrOfSubTasks).toBe(3); // Tasks 2, 3, and 5
        expect(result.nrOfParentTasks).toBe(2); // Tasks 1 and 4
        expect(result.nrOfCompletedTasks).toBe(3); // Tasks 1, 2, and 5

        // avgTimeSpentOnTaskIncludingSubTasks should exclude parent tasks
        // Formula: timeSpent / (nrOfAllTasks - nrOfParentTasks)
        // 1000 / (5 - 2) = 1000 / 3
        expect(result.avgTimeSpentOnTaskIncludingSubTasks).toBe(1000 / 3);
      });

      it('should aggregate multiple years of worklog data', () => {
        const tasks: Task[] = [createTask()];
        const breakNr: BreakNr = {};
        const breakTime: BreakTime = {};
        const worklog = createWorklog([
          {
            year: 2023,
            months: [
              {
                month: 12,
                days: [
                  { day: 25, timeSpent: 1000 },
                  { day: 26, timeSpent: 2000 },
                ],
              },
            ],
          },
          {
            year: 2024,
            months: [
              {
                month: 1,
                days: [
                  { day: 1, timeSpent: 3000 },
                  { day: 2, timeSpent: 4000 },
                ],
              },
              {
                month: 6,
                days: [{ day: 15, timeSpent: 5000 }],
              },
            ],
          },
          {
            year: 2025,
            months: [
              {
                month: 1,
                days: [
                  { day: 15, timeSpent: 6000 },
                  { day: 16, timeSpent: 7000 },
                ],
              },
            ],
          },
        ]);
        const totalTimeSpent = 28000;

        const result = mapSimpleMetrics([
          breakNr,
          breakTime,
          worklog,
          totalTimeSpent,
          tasks,
        ]);

        expect(result.daysWorked).toBe(7); // 2 + 3 + 2
        expect(result.timeSpent).toBe(28000);
        expect(result.avgTimeSpentOnDay).toBe(4000); // 28000 / 7
      });

      it('should handle empty break data', () => {
        const tasks: Task[] = [createTask()];
        const breakNr: BreakNr = {};
        const breakTime: BreakTime = {};
        const worklog = createWorklog([
          { year: 2025, months: [{ month: 1, days: [{ day: 15, timeSpent: 1000 }] }] },
        ]);

        const result = mapSimpleMetrics([breakNr, breakTime, worklog, 1000, tasks]);

        expect(result.breakNr).toBe(0);
        expect(result.breakTime).toBe(0);
        expect(result.avgBreakNr).toBe(0);
        expect(result.avgBreakTime).toBe(0);
      });

      it('should aggregate breaks across multiple dates', () => {
        const tasks: Task[] = [createTask()];
        const breakNr: BreakNr = {
          '2025-01-15': 2,
          '2025-01-16': 3,
          '2025-01-17': 1,
        };
        const breakTime: BreakTime = {
          '2025-01-15': 600000,
          '2025-01-16': 900000,
          '2025-01-17': 300000,
        };
        const worklog = createWorklog([
          {
            year: 2025,
            months: [
              {
                month: 1,
                days: [
                  { day: 15, timeSpent: 1000 },
                  { day: 16, timeSpent: 2000 },
                  { day: 17, timeSpent: 3000 },
                ],
              },
            ],
          },
        ]);

        const result = mapSimpleMetrics([breakNr, breakTime, worklog, 6000, tasks]);

        expect(result.breakNr).toBe(6); // 2 + 3 + 1
        expect(result.breakTime).toBe(1800000); // 600000 + 900000 + 300000
      });

      it('should set end date to today', () => {
        const tasks: Task[] = [createTask()];
        const breakNr: BreakNr = {};
        const breakTime: BreakTime = {};
        const worklog = createWorklog([
          { year: 2025, months: [{ month: 1, days: [{ day: 15, timeSpent: 1000 }] }] },
        ]);

        const result = mapSimpleMetrics([breakNr, breakTime, worklog, 1000, tasks]);

        expect(result.end).toBe(getDbDateStr());
      });
    });
  });
});
