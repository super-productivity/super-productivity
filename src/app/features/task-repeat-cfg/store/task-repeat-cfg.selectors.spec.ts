import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { TaskReminderOptionId } from '../../tasks/task.model';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDbDateStr } from '../../../util/get-db-date-str';
import {
  selectAllUnprocessedTaskRepeatCfgs,
  selectTaskRepeatCfgsForExactDay,
  selectAllTaskRepeatCfgs,
  selectTaskRepeatCfgById,
  selectTaskRepeatCfgByIdAllowUndefined,
  selectTaskRepeatCfgsWithStartTime,
  selectTaskRepeatCfgsWithAndWithoutStartTime,
  selectTaskRepeatCfgsSortedByTitleAndProject,
} from './task-repeat-cfg.selectors';

const DUMMY_REPEATABLE_TASK: TaskRepeatCfg = {
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'REPEATABLE_DEFAULT',
  title: 'REPEATABLE_DEFAULT',
  quickSetting: 'DAILY',
  lastTaskCreationDay: '1970-01-01',
  defaultEstimate: undefined,
  projectId: null,
  startTime: undefined,
  remindAt: undefined,
  isPaused: false,
  repeatCycle: 'WEEKLY',
  startDate: undefined,
  repeatEvery: 1,
  monday: false,
  tuesday: false,
  wednesday: false,
  thursday: false,
  friday: false,
  saturday: false,
  sunday: false,
  tagIds: [],
  order: 0,
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const FAKE_MONDAY_THE_10TH = new Date(2022, 0, 10).getTime();

const dummyRepeatable = (id: string, fields: Partial<TaskRepeatCfg>): TaskRepeatCfg => ({
  ...DUMMY_REPEATABLE_TASK,
  id,
  ...fields,
});

describe('selectTaskRepeatCfgsDueOnDay', () => {
  describe('for DAILY', () => {
    it('should return cfg for a far future task', () => {
      const result = selectTaskRepeatCfgsForExactDay.projector(
        [
          dummyRepeatable('R1', {
            repeatCycle: 'DAILY',
            startDate: '2022-01-10',
          }),
        ],
        {
          dayDate: dateStrToUtcDate('2025-11-11').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    [
      new Date(2022, 0, 10), // Jan 10, 2022 (start date, day 0)
      new Date(2022, 0, 13), // Jan 13, 2022 (day 3)
      new Date(2022, 0, 16), // Jan 16, 2022 (day 6)
      new Date(2022, 10, 6), // Nov 6, 2022 (day 300)
      new Date(2022, 6, 9), // Jul 9, 2022 (day 150)
    ].forEach((testDate) => {
      it('should return cfg for a for repeatEvery correctly', () => {
        const result = selectTaskRepeatCfgsForExactDay.projector(
          [
            dummyRepeatable('R1', {
              repeatCycle: 'DAILY',
              repeatEvery: 3,
              startDate: '2022-01-10',
            }),
          ],
          {
            dayDate: testDate.getTime(),
          },
        );
        const resultIds = result.map((item) => item.id);
        expect(resultIds).toEqual(['R1']);
      });
    });

    [
      FAKE_MONDAY_THE_10TH + 11,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 3 + HOUR * 22,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 6 + HOUR * 3,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 702 + HOUR * 2,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 150 + HOUR * 6,
    ].forEach((dayDateStr) => {
      it('should return cfg for a for repeatEvery correctly for non exact day dates', () => {
        const result = selectTaskRepeatCfgsForExactDay.projector(
          [
            dummyRepeatable('R1', {
              repeatCycle: 'DAILY',
              repeatEvery: 3,
              startDate: '2022-01-10',
            }),
          ],
          {
            dayDate: new Date(dayDateStr).getTime(),
          },
        );
        const resultIds = result.map((item) => item.id);
        expect(resultIds).toEqual(['R1']);
      });
    });

    [
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 11,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 21,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 34,
    ].forEach((dayDateStr) => {
      it('should NOT return cfg for a for repeatEvery if not correct', () => {
        const result = selectTaskRepeatCfgsForExactDay.projector(
          [
            dummyRepeatable('R1', {
              repeatCycle: 'DAILY',
              repeatEvery: 4,
              startDate: '2022-01-10',
            }),
          ],
          {
            dayDate: new Date(dayDateStr).getTime(),
          },
        );
        const resultIds = result.map((item) => item.id);
        expect(resultIds).toEqual([]);
      });
    });

    [
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 2,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 4,
    ].forEach((dayDateStr) => {
      it('should return cfg for a for repeatEvery if correct', () => {
        const result = selectTaskRepeatCfgsForExactDay.projector(
          [
            dummyRepeatable('R1', {
              repeatCycle: 'DAILY',
              repeatEvery: 2,
              startDate: '2022-01-10',
              startTime: '10:00',
              remindAt: TaskReminderOptionId.AtStart,
            }),
          ],
          {
            dayDate: new Date(dayDateStr).getTime(),
          },
        );
        const resultIds = result.map((item) => item.id);
        expect(resultIds).toEqual(['R1']);
      });
    });
  });

  describe('for WEEKLY', () => {
    it('should return cfg for startDate today', () => {
      const result = selectTaskRepeatCfgsForExactDay.projector(
        [
          dummyRepeatable('R1', {
            repeatCycle: 'WEEKLY',
            startDate: '2022-01-10',
            monday: true,
          }),
        ],
        {
          dayDate: FAKE_MONDAY_THE_10TH,
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should return cfg for startDate in the past', () => {
      const result = selectTaskRepeatCfgsForExactDay.projector(
        [
          dummyRepeatable('R1', {
            repeatCycle: 'WEEKLY',
            repeatEvery: 1,
            startDate: '2022-01-10',
            monday: true,
          }),
        ],
        {
          dayDate: dateStrToUtcDate('2022-02-07').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should return available for day', () => {
      const result = selectTaskRepeatCfgsForExactDay.projector(
        [
          dummyRepeatable('R1', {
            monday: true,
            startDate: '2022-01-10',
            repeatCycle: 'WEEKLY',
          }),
        ],
        {
          dayDate: FAKE_MONDAY_THE_10TH,
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should work correctly for a week', () => {
      const repeatableTasks = [
        dummyRepeatable('R1', {
          monday: true,
          startDate: '2022-01-10',
          repeatCycle: 'WEEKLY',
        }),
        dummyRepeatable('R2', {
          wednesday: true,
          startDate: '2022-01-10',
          repeatCycle: 'WEEKLY',
        }),
      ];
      // eslint-disable-next-line no-mixed-operators
      const FULL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((v) => FAKE_MONDAY_THE_10TH + v * DAY);
      const results = FULL_WEEK.map((dayTimestamp) =>
        selectTaskRepeatCfgsForExactDay
          .projector(repeatableTasks, { dayDate: dayTimestamp })
          .map((item) => item.id),
      );
      expect(results).toEqual([['R1'], [], ['R2'], [], [], [], []]);
    });

    // it('should NOT return cfg for future startDate', () => {
    //   const result = selectTaskRepeatCfgsForExactDay.projector(
    //     [dummyRepeatable('R1', { repeatCycle: 'WEEKLY', startDate: '2022-02-10' })],
    //     {
    //       dayDate: FAKE_MONDAY_THE_10TH,
    //     },
    //   );
    //   const resultIds = result.map((item) => item.id);
    //   expect(resultIds).toEqual([]);
    // });
    // it('should return cfg if repeatCycle matches', () => {
    //   const result = selectTaskRepeatCfgsForExactDay.projector(
    //     [
    //       dummyRepeatable('R1', {
    //         repeatCycle: 'WEEKLY',
    //         startDate: '2022-01-10',
    //         repeatEvery: 2,
    //       }),
    //     ],
    //     {
    //       dayDate: dateStrToUtcDate('2022-03-10').getTime(),
    //     },
    //   );
    //   const resultIds = result.map((item) => item.id);
    //   expect(resultIds).toEqual(['R1']);
    // });
    // it('should NOT return cfg if repeatCycle does NOT match', () => {
    //   const result = selectTaskRepeatCfgsForExactDay.projector(
    //     [
    //       dummyRepeatable('R1', {
    //         repeatCycle: 'WEEKLY',
    //         startDate: '2022-01-10',
    //         repeatEvery: 3,
    //       }),
    //     ],
    //     {
    //       dayDate: dateStrToUtcDate('2022-03-10').getTime(),
    //     },
    //   );
    //   const resultIds = result.map((item) => item.id);
    //   expect(resultIds).toEqual([]);
    // });
  });

  describe('for MONTHLY', () => {
    it('should return cfg for startDate today', () => {
      const result = selectTaskRepeatCfgsForExactDay.projector(
        [dummyRepeatable('R1', { repeatCycle: 'MONTHLY', startDate: '2022-01-10' })],
        {
          dayDate: FAKE_MONDAY_THE_10TH,
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should return cfg for startDate in the past', () => {
      const result = selectTaskRepeatCfgsForExactDay.projector(
        [dummyRepeatable('R1', { repeatCycle: 'MONTHLY', startDate: '2022-01-10' })],
        {
          dayDate: dateStrToUtcDate('2022-02-10').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should NOT return cfg for future startDate', () => {
      const result = selectTaskRepeatCfgsForExactDay.projector(
        [dummyRepeatable('R1', { repeatCycle: 'MONTHLY', startDate: '2022-02-10' })],
        {
          dayDate: FAKE_MONDAY_THE_10TH,
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual([]);
    });

    it('should return cfg if repeatCycle matches', () => {
      const result = selectTaskRepeatCfgsForExactDay.projector(
        [
          dummyRepeatable('R1', {
            repeatCycle: 'MONTHLY',
            startDate: '2022-01-10',
            repeatEvery: 2,
          }),
        ],
        {
          dayDate: dateStrToUtcDate('2022-03-10').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should NOT return cfg if repeatCycle does NOT match', () => {
      const result = selectTaskRepeatCfgsForExactDay.projector(
        [
          dummyRepeatable('R1', {
            repeatCycle: 'MONTHLY',
            startDate: '2022-01-10',
            repeatEvery: 3,
          }),
        ],
        {
          dayDate: dateStrToUtcDate('2022-03-10').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual([]);
    });
  });

  describe('for YEARLY', () => {
    it('should return cfg for startDate today', () => {
      const result = selectTaskRepeatCfgsForExactDay.projector(
        [dummyRepeatable('R1', { repeatCycle: 'YEARLY', startDate: '2022-01-10' })],
        {
          dayDate: FAKE_MONDAY_THE_10TH,
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should return cfg for startDate in the past', () => {
      const result = selectTaskRepeatCfgsForExactDay.projector(
        [dummyRepeatable('R1', { repeatCycle: 'YEARLY', startDate: '2021-01-10' })],
        {
          dayDate: dateStrToUtcDate('2022-01-10').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should NOT return cfg for future startDate', () => {
      const result = selectTaskRepeatCfgsForExactDay.projector(
        [dummyRepeatable('R1', { repeatCycle: 'YEARLY', startDate: '2023-01-10' })],
        {
          dayDate: FAKE_MONDAY_THE_10TH,
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual([]);
    });

    it('should return cfg if repeatCycle matches', () => {
      const result = selectTaskRepeatCfgsForExactDay.projector(
        [
          dummyRepeatable('R1', {
            repeatCycle: 'YEARLY',
            startDate: '2024-01-10',
            repeatEvery: 2,
          }),
        ],
        {
          dayDate: dateStrToUtcDate('2024-01-10').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should NOT return cfg if repeatCycle does NOT match', () => {
      const result = selectTaskRepeatCfgsForExactDay.projector(
        [
          dummyRepeatable('R1', {
            repeatCycle: 'YEARLY',
            startDate: '2022-01-10',
            lastTaskCreationDay: '2022-01-10',
            repeatEvery: 2,
          }),
        ],
        {
          dayDate: dateStrToUtcDate('2023-01-10').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      console.log(result);

      expect(resultIds).toEqual([]);
    });
  });
});

// -----------------------------------------------------------------------------------

describe('selectAllUnprocessedTaskRepeatCfgs', () => {
  it('should not return values for Marco`s edge case', () => {
    const result = selectAllUnprocessedTaskRepeatCfgs.projector(
      [
        dummyRepeatable('R1', {
          repeatCycle: 'MONTHLY',
          repeatEvery: 1,
          startDate: '2024-01-26',
          lastTaskCreationDay: '2024-06-26',
        }),
      ],
      {
        dayDate: dateStrToUtcDate('2024-07-16').getTime(),
      },
    );
    const resultIds = result.map((item) => item.id);
    console.log(resultIds);

    expect(resultIds).toEqual([]);
  });

  describe('for DAILY', () => {
    it('should return cfg for a far future task', () => {
      const result = selectAllUnprocessedTaskRepeatCfgs.projector(
        [
          dummyRepeatable('R1', {
            repeatCycle: 'DAILY',
            startDate: '2022-01-10',
          }),
        ],
        {
          dayDate: dateStrToUtcDate('2025-11-11').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    [
      FAKE_MONDAY_THE_10TH,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 3,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 6,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 300,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 150,
    ].forEach((dayDateStr) => {
      it('should return cfg for a for repeatEvery correctly', () => {
        const result = selectAllUnprocessedTaskRepeatCfgs.projector(
          [
            dummyRepeatable('R1', {
              repeatCycle: 'DAILY',
              repeatEvery: 3,
              startDate: '2022-01-10',
            }),
          ],
          {
            dayDate: new Date(dayDateStr).getTime(),
          },
        );
        const resultIds = result.map((item) => item.id);
        expect(resultIds).toEqual(['R1']);
      });
    });

    [
      FAKE_MONDAY_THE_10TH + 11,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 3 + HOUR * 22,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 6 + HOUR * 3,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 702 + HOUR * 2,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 150 + HOUR * 6,
    ].forEach((dayDateStr) => {
      it('should return cfg for a for repeatEvery correctly for non exact day dates', () => {
        const result = selectAllUnprocessedTaskRepeatCfgs.projector(
          [
            dummyRepeatable('R1', {
              repeatCycle: 'DAILY',
              repeatEvery: 3,
              startDate: '2022-01-10',
            }),
          ],
          {
            dayDate: new Date(dayDateStr).getTime(),
          },
        );
        const resultIds = result.map((item) => item.id);
        expect(resultIds).toEqual(['R1']);
      });
    });

    [
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 2,
      // eslint-disable-next-line no-mixed-operators
      FAKE_MONDAY_THE_10TH + DAY * 4,
    ].forEach((dayDateStr) => {
      it('should return cfg for a for repeatEvery if correct', () => {
        const result = selectAllUnprocessedTaskRepeatCfgs.projector(
          [
            dummyRepeatable('R1', {
              repeatCycle: 'DAILY',
              repeatEvery: 2,
              startDate: '2022-01-10',
              startTime: '10:00',
              remindAt: TaskReminderOptionId.AtStart,
            }),
          ],
          {
            dayDate: new Date(dayDateStr).getTime(),
          },
        );
        const resultIds = result.map((item) => item.id);
        expect(resultIds).toEqual(['R1']);
      });
    });
  });

  describe('for WEEKLY', () => {
    it('should return cfg for startDate today', () => {
      const result = selectAllUnprocessedTaskRepeatCfgs.projector(
        [
          dummyRepeatable('R1', {
            repeatCycle: 'WEEKLY',
            startDate: '2022-01-10',
            monday: true,
          }),
        ],
        {
          dayDate: FAKE_MONDAY_THE_10TH,
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should return cfg for startDate in the past', () => {
      const result = selectAllUnprocessedTaskRepeatCfgs.projector(
        [
          dummyRepeatable('R1', {
            repeatCycle: 'WEEKLY',
            repeatEvery: 1,
            startDate: '2022-01-10',
            monday: true,
          }),
        ],
        {
          dayDate: dateStrToUtcDate('2022-02-07').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should return available for day', () => {
      const result = selectAllUnprocessedTaskRepeatCfgs.projector(
        [
          dummyRepeatable('R1', {
            monday: true,
            startDate: '2022-01-10',
            repeatCycle: 'WEEKLY',
          }),
        ],
        {
          dayDate: FAKE_MONDAY_THE_10TH,
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });
  });

  describe('for MONTHLY', () => {
    it('should return cfg for startDate today', () => {
      const result = selectAllUnprocessedTaskRepeatCfgs.projector(
        [dummyRepeatable('R1', { repeatCycle: 'MONTHLY', startDate: '2022-01-10' })],
        {
          dayDate: FAKE_MONDAY_THE_10TH,
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should return cfg for startDate in the past', () => {
      const result = selectAllUnprocessedTaskRepeatCfgs.projector(
        [dummyRepeatable('R1', { repeatCycle: 'MONTHLY', startDate: '2022-01-10' })],
        {
          dayDate: dateStrToUtcDate('2022-02-10').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should NOT return cfg for future startDate', () => {
      const result = selectAllUnprocessedTaskRepeatCfgs.projector(
        [dummyRepeatable('R1', { repeatCycle: 'MONTHLY', startDate: '2022-02-10' })],
        {
          dayDate: FAKE_MONDAY_THE_10TH,
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual([]);
    });

    it('should return cfg if repeatCycle matches', () => {
      const result = selectAllUnprocessedTaskRepeatCfgs.projector(
        [
          dummyRepeatable('R1', {
            repeatCycle: 'MONTHLY',
            startDate: '2022-01-10',
            repeatEvery: 2,
          }),
        ],
        {
          dayDate: dateStrToUtcDate('2022-03-10').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should NOT return cfg if repeatCycle does NOT match', () => {
      const result = selectAllUnprocessedTaskRepeatCfgs.projector(
        [
          dummyRepeatable('R1', {
            repeatCycle: 'MONTHLY',
            startDate: '2022-01-10',
            repeatEvery: 3,
            lastTaskCreationDay: '2022-01-10',
          }),
        ],
        {
          dayDate: dateStrToUtcDate('2022-03-10').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual([]);
    });
  });

  describe('for YEARLY', () => {
    it('should return cfg for startDate today', () => {
      const result = selectAllUnprocessedTaskRepeatCfgs.projector(
        [dummyRepeatable('R1', { repeatCycle: 'YEARLY', startDate: '2022-01-10' })],
        {
          dayDate: FAKE_MONDAY_THE_10TH,
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should return cfg for startDate in the past', () => {
      const result = selectAllUnprocessedTaskRepeatCfgs.projector(
        [dummyRepeatable('R1', { repeatCycle: 'YEARLY', startDate: '2021-01-10' })],
        {
          dayDate: dateStrToUtcDate('2022-01-10').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should NOT return cfg for future startDate', () => {
      const result = selectAllUnprocessedTaskRepeatCfgs.projector(
        [dummyRepeatable('R1', { repeatCycle: 'YEARLY', startDate: '2023-01-10' })],
        {
          dayDate: FAKE_MONDAY_THE_10TH,
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual([]);
    });

    it('should return cfg if repeatCycle matches', () => {
      const result = selectAllUnprocessedTaskRepeatCfgs.projector(
        [
          dummyRepeatable('R1', {
            repeatCycle: 'YEARLY',
            startDate: '2024-01-10',
            repeatEvery: 2,
          }),
        ],
        {
          dayDate: dateStrToUtcDate('2024-01-10').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);
      expect(resultIds).toEqual(['R1']);
    });

    it('should NOT return cfg if repeatCycle does NOT match', () => {
      const result = selectAllUnprocessedTaskRepeatCfgs.projector(
        [
          dummyRepeatable('R1', {
            repeatCycle: 'YEARLY',
            startDate: '2022-01-10',
            lastTaskCreationDay: '2022-01-10',
            repeatEvery: 2,
          }),
        ],
        {
          dayDate: dateStrToUtcDate('2023-01-10').getTime(),
        },
      );
      const resultIds = result.map((item) => item.id);

      expect(resultIds).toEqual([]);
    });
  });
});

describe('selectAllTaskRepeatCfgs', () => {
  it('should return all task repeat configs', () => {
    const cfg1 = dummyRepeatable('R1', { title: 'Task 1' });
    const cfg2 = dummyRepeatable('R2', { title: 'Task 2' });
    const cfg3 = dummyRepeatable('R3', { title: 'Task 3' });

    const state = {
      ids: ['R1', 'R2', 'R3'],
      entities: {
        R1: cfg1,
        R2: cfg2,
        R3: cfg3,
      },
    };

    const result = selectAllTaskRepeatCfgs.projector(state);
    expect(result).toEqual([cfg1, cfg2, cfg3]);
  });

  it('should return empty array when no configs', () => {
    const state = {
      ids: [],
      entities: {},
    };

    const result = selectAllTaskRepeatCfgs.projector(state);
    expect(result).toEqual([]);
  });
});

describe('selectTaskRepeatCfgById', () => {
  it('should return the config by id', () => {
    const cfg1 = dummyRepeatable('R1', { title: 'Task 1' });
    const cfg2 = dummyRepeatable('R2', { title: 'Task 2' });

    const state = {
      ids: ['R1', 'R2'],
      entities: {
        R1: cfg1,
        R2: cfg2,
      },
    };

    const result = selectTaskRepeatCfgById.projector(state, { id: 'R1' });
    expect(result).toEqual(cfg1);
  });

  it('should throw error when config not found', () => {
    const state = {
      ids: [],
      entities: {},
    };

    expect(() => selectTaskRepeatCfgById.projector(state, { id: 'R1' })).toThrowError(
      'Missing taskRepeatCfg',
    );
  });
});

describe('selectTaskRepeatCfgByIdAllowUndefined', () => {
  it('should return the config by id', () => {
    const cfg1 = dummyRepeatable('R1', { title: 'Task 1' });

    const state = {
      ids: ['R1'],
      entities: {
        R1: cfg1,
      },
    };

    const result = selectTaskRepeatCfgByIdAllowUndefined.projector(state, { id: 'R1' });
    expect(result).toEqual(cfg1);
  });

  it('should return undefined when config not found', () => {
    const state = {
      ids: [],
      entities: {},
    };

    const result = selectTaskRepeatCfgByIdAllowUndefined.projector(state, { id: 'R1' });
    expect(result).toBeUndefined();
  });
});

describe('selectTaskRepeatCfgsWithStartTime', () => {
  it('should return only configs with start time', () => {
    const cfg1 = dummyRepeatable('R1', { title: 'Task 1', startTime: '10:00' });
    const cfg2 = dummyRepeatable('R2', { title: 'Task 2', startTime: undefined });
    const cfg3 = dummyRepeatable('R3', { title: 'Task 3', startTime: '14:30' });

    const result = selectTaskRepeatCfgsWithStartTime.projector([cfg1, cfg2, cfg3]);
    expect(result).toEqual([cfg1, cfg3]);
  });

  it('should return empty array when no configs have start time', () => {
    const cfg1 = dummyRepeatable('R1', { title: 'Task 1', startTime: undefined });
    const cfg2 = dummyRepeatable('R2', { title: 'Task 2', startTime: undefined });

    const result = selectTaskRepeatCfgsWithStartTime.projector([cfg1, cfg2]);
    expect(result).toEqual([]);
  });
});

describe('selectTaskRepeatCfgsWithAndWithoutStartTime', () => {
  it('should correctly separate configs with and without start time', () => {
    const cfg1 = dummyRepeatable('R1', { title: 'Task 1', startTime: '10:00' });
    const cfg2 = dummyRepeatable('R2', { title: 'Task 2', startTime: undefined });
    const cfg3 = dummyRepeatable('R3', { title: 'Task 3', startTime: '14:30' });
    const cfg4 = dummyRepeatable('R4', { title: 'Task 4', startTime: undefined });

    const result = selectTaskRepeatCfgsWithAndWithoutStartTime.projector([
      cfg1,
      cfg2,
      cfg3,
      cfg4,
    ]);
    expect(result.withStartTime).toEqual([cfg1, cfg3]);
    expect(result.withoutStartTime).toEqual([cfg2, cfg4]);
  });

  it('should handle all configs with start time', () => {
    const cfg1 = dummyRepeatable('R1', { title: 'Task 1', startTime: '10:00' });
    const cfg2 = dummyRepeatable('R2', { title: 'Task 2', startTime: '14:30' });

    const result = selectTaskRepeatCfgsWithAndWithoutStartTime.projector([cfg1, cfg2]);
    expect(result.withStartTime).toEqual([cfg1, cfg2]);
    expect(result.withoutStartTime).toEqual([]);
  });

  it('should handle all configs without start time', () => {
    const cfg1 = dummyRepeatable('R1', { title: 'Task 1', startTime: undefined });
    const cfg2 = dummyRepeatable('R2', { title: 'Task 2', startTime: undefined });

    const result = selectTaskRepeatCfgsWithAndWithoutStartTime.projector([cfg1, cfg2]);
    expect(result.withStartTime).toEqual([]);
    expect(result.withoutStartTime).toEqual([cfg1, cfg2]);
  });
});

describe('selectTaskRepeatCfgsSortedByTitleAndProject', () => {
  it('should sort by project first (null projects first), then by title', () => {
    const cfg1 = dummyRepeatable('R1', { title: 'B Task', projectId: 'proj2' });
    const cfg2 = dummyRepeatable('R2', { title: 'A Task', projectId: 'proj1' });
    const cfg3 = dummyRepeatable('R3', { title: 'C Task', projectId: null });
    const cfg4 = dummyRepeatable('R4', { title: 'D Task', projectId: null });
    const cfg5 = dummyRepeatable('R5', { title: 'E Task', projectId: 'proj1' });

    const result = selectTaskRepeatCfgsSortedByTitleAndProject.projector([
      cfg1,
      cfg2,
      cfg3,
      cfg4,
      cfg5,
    ]);

    // Expected order: null projects first (sorted by title), then by project ID (sorted by title within project)
    expect(result).toEqual([
      cfg3, // C Task (null project)
      cfg4, // D Task (null project)
      cfg2, // A Task (proj1)
      cfg5, // E Task (proj1)
      cfg1, // B Task (proj2)
    ]);
  });

  it('should handle empty title', () => {
    const cfg1 = dummyRepeatable('R1', { title: '', projectId: null });
    const cfg2 = dummyRepeatable('R2', { title: 'A Task', projectId: null });

    const result = selectTaskRepeatCfgsSortedByTitleAndProject.projector([cfg1, cfg2]);

    expect(result).toEqual([cfg1, cfg2]);
  });

  it('should handle same project and title', () => {
    const cfg1 = dummyRepeatable('R1', { title: 'Same Task', projectId: 'proj1' });
    const cfg2 = dummyRepeatable('R2', { title: 'Same Task', projectId: 'proj1' });

    const result = selectTaskRepeatCfgsSortedByTitleAndProject.projector([cfg1, cfg2]);

    // Order should be preserved when title and project are the same
    expect(result).toEqual([cfg1, cfg2]);
  });
});

// Issue #5806: Planner shows less scheduled tasks than scheduled/planned view
describe('Issue #5806 - Weekly tasks with correct weekday show in planner', () => {
  it('should show task on Sunday when sunday=true and checking Sunday', () => {
    // This is the CORRECT scenario after the fix
    const sunday = dateStrToUtcDate('2025-12-28'); // Sunday
    const result = selectTaskRepeatCfgsForExactDay.projector(
      [
        dummyRepeatable('R1', {
          repeatCycle: 'WEEKLY',
          startDate: '2025-12-26', // Friday (when task was created)
          lastTaskCreationDay: '1970-01-01',
          sunday: true, // Correctly set to Sunday (the scheduled day)
        }),
      ],
      { dayDate: sunday.getTime() },
    );
    expect(result.map((r) => r.id)).toEqual(['R1']);
  });

  it('should NOT show task on Sunday when only friday=true (the bug scenario)', () => {
    // This demonstrates the bug: task created on Friday with WEEKLY_CURRENT_WEEKDAY
    // would set friday=true instead of sunday=true
    const sunday = dateStrToUtcDate('2025-12-28'); // Sunday
    const result = selectTaskRepeatCfgsForExactDay.projector(
      [
        dummyRepeatable('R1', {
          repeatCycle: 'WEEKLY',
          startDate: '2025-12-26', // Friday
          lastTaskCreationDay: '1970-01-01',
          friday: true, // Wrong! Should be sunday=true
          sunday: false,
        }),
      ],
      { dayDate: sunday.getTime() },
    );
    // Task does NOT show on Sunday because sunday=false
    expect(result.map((r) => r.id)).toEqual([]);
  });

  it('should show multiple tasks when all have correct weekday set', () => {
    // Simulates 4 tasks all scheduled for Sunday with sunday=true
    const sunday = dateStrToUtcDate('2025-12-28');
    const result = selectTaskRepeatCfgsForExactDay.projector(
      [
        dummyRepeatable('R1', {
          repeatCycle: 'WEEKLY',
          startDate: '2025-12-26',
          lastTaskCreationDay: '1970-01-01',
          sunday: true,
        }),
        dummyRepeatable('R2', {
          repeatCycle: 'WEEKLY',
          startDate: '2025-12-26',
          lastTaskCreationDay: '1970-01-01',
          sunday: true,
        }),
        dummyRepeatable('R3', {
          repeatCycle: 'WEEKLY',
          startDate: '2025-12-26',
          lastTaskCreationDay: '1970-01-01',
          sunday: true,
        }),
        dummyRepeatable('R4', {
          repeatCycle: 'WEEKLY',
          startDate: '2025-12-26',
          lastTaskCreationDay: '1970-01-01',
          sunday: true,
        }),
      ],
      { dayDate: sunday.getTime() },
    );
    // All 4 tasks should show
    expect(result.map((r) => r.id)).toEqual(['R1', 'R2', 'R3', 'R4']);
  });

  it('should show only tasks with correct weekday (mixed scenario)', () => {
    // 2 with sunday=true, 2 with friday=true (wrong)
    const sunday = dateStrToUtcDate('2025-12-28');
    const result = selectTaskRepeatCfgsForExactDay.projector(
      [
        dummyRepeatable('R1', {
          repeatCycle: 'WEEKLY',
          startDate: '2025-12-26',
          lastTaskCreationDay: '1970-01-01',
          sunday: true, // Correct
        }),
        dummyRepeatable('R2', {
          repeatCycle: 'WEEKLY',
          startDate: '2025-12-26',
          lastTaskCreationDay: '1970-01-01',
          friday: true, // Wrong
          sunday: false,
        }),
        dummyRepeatable('R3', {
          repeatCycle: 'WEEKLY',
          startDate: '2025-12-26',
          lastTaskCreationDay: '1970-01-01',
          sunday: true, // Correct
        }),
        dummyRepeatable('R4', {
          repeatCycle: 'WEEKLY',
          startDate: '2025-12-26',
          lastTaskCreationDay: '1970-01-01',
          friday: true, // Wrong
          sunday: false,
        }),
      ],
      { dayDate: sunday.getTime() },
    );
    // Only 2 tasks with sunday=true should show (explains "2 of 4" from bug report)
    expect(result.map((r) => r.id)).toEqual(['R1', 'R3']);
  });
});

describe('Timezone Edge Cases for selectTaskRepeatCfgsForExactDay', () => {
  const createTaskRepeatCfg = (id: string, lastDay: string): TaskRepeatCfg => ({
    ...DEFAULT_TASK_REPEAT_CFG,
    id,
    lastTaskCreationDay: lastDay,
    repeatCycle: 'DAILY',
    repeatEvery: 1,
    startDate: '2025-01-01',
  });

  it('should handle late night task creation correctly', () => {
    const lateNight = new Date('2025-08-01T23:30:00'); // 11:30 PM
    const configs = [
      createTaskRepeatCfg('R1', '2025-08-01'), // Created earlier today
      createTaskRepeatCfg('R2', '2025-07-31'), // Created yesterday
    ];

    const result = selectTaskRepeatCfgsForExactDay.projector(configs, {
      dayDate: lateNight.getTime(),
    });

    // Should return the one created yesterday since today is its due date
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('R2');
  });

  it('should handle early morning checks correctly', () => {
    const earlyMorning = new Date('2025-08-02T01:00:00'); // 1 AM next day
    const configs = [
      createTaskRepeatCfg('R1', '2025-08-01'), // Created yesterday (from perspective of 1 AM)
      createTaskRepeatCfg('R2', '2025-08-02'), // Already created today
    ];

    const result = selectTaskRepeatCfgsForExactDay.projector(configs, {
      dayDate: earlyMorning.getTime(),
    });

    expect(result.length).toBe(1);
    expect(result[0].id).toBe('R1');
  });

  it('should handle future creation dates correctly', () => {
    const today = new Date('2025-08-01T12:00:00');
    const configs = [
      createTaskRepeatCfg('R1', '2025-08-02'), // Future date (should not process)
      createTaskRepeatCfg('R2', '2025-07-31'), // Yesterday
    ];

    const result = selectTaskRepeatCfgsForExactDay.projector(configs, {
      dayDate: today.getTime(),
    });

    expect(result.length).toBe(1);
    expect(result[0].id).toBe('R2');
  });

  it('should prevent the reported bug: task created at 11 PM shows up next day', () => {
    // Simulate: User creates task at 11 PM
    const creationTime = new Date('2025-08-01T23:00:00');
    const taskConfig: TaskRepeatCfg = {
      ...DEFAULT_TASK_REPEAT_CFG,
      id: 'test',
      lastTaskCreationDay: getDbDateStr(creationTime), // '2025-08-01'
      repeatCycle: 'DAILY',
      repeatEvery: 1,
      startDate: '2025-01-01',
    };

    // Check at 1 AM next day
    const checkTime = new Date('2025-08-02T01:00:00');
    const todayStr = getDbDateStr(checkTime); // '2025-08-02'

    // The fix: String comparison shows they're different days
    const shouldCreateTask = taskConfig.lastTaskCreationDay !== todayStr;
    expect(shouldCreateTask).toBe(true);

    // But if checking later on Aug 1st
    const laterSameDay = new Date('2025-08-01T23:30:00');
    const sameDayStr = getDbDateStr(laterSameDay); // '2025-08-01'
    const shouldNotCreate = taskConfig.lastTaskCreationDay === sameDayStr;
    expect(shouldNotCreate).toBe(true);
  });
});
