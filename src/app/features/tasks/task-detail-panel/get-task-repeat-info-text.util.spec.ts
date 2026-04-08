import { getTaskRepeatInfoText } from './get-task-repeat-info-text.util';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
} from '../../task-repeat-cfg/task-repeat-cfg.model';
import { T } from '../../../t.const';

describe('getTaskRepeatInfoText()', () => {
  (
    [
      // TODO make case work:
      // [
      //   T.F.TASK_REPEAT.ADD_INFO_PANEL.DAILY,
      //   undefined,
      //   { ...DEFAULT_TASK_REPEAT_CFG, repeatEvery: 2, repeatCycle: 'DAILY' },
      // ],

      [
        T.F.TASK_REPEAT.ADD_INFO_PANEL.DAILY,
        undefined,
        {
          repeatEvery: 1,
          repeatCycle: 'DAILY',
          quickSetting: 'DAILY',
        },
      ],
      [
        T.F.TASK_REPEAT.ADD_INFO_PANEL.DAILY,
        undefined,
        {
          repeatEvery: 1,
          repeatCycle: 'DAILY',
          quickSetting: 'CUSTOM',
        },
      ],
      [
        T.F.TASK_REPEAT.ADD_INFO_PANEL.DAILY_AND_TIME,
        { timeStr: '10:00 AM' },
        {
          repeatEvery: 1,
          repeatCycle: 'DAILY',
          quickSetting: 'CUSTOM',
          startTime: '10:00',
        },
      ],
      [
        T.F.TASK_REPEAT.ADD_INFO_PANEL.MONDAY_TO_FRIDAY,
        undefined,
        {
          repeatEvery: 1,
          repeatCycle: 'WEEKLY',
          quickSetting: 'MONDAY_TO_FRIDAY',
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: false,
          sunday: false,
        },
      ],
      [
        T.F.TASK_REPEAT.ADD_INFO_PANEL.MONDAY_TO_FRIDAY,
        undefined,
        {
          repeatEvery: 1,
          repeatCycle: 'WEEKLY',
          quickSetting: 'CUSTOM',
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: false,
          sunday: false,
        },
      ],
      [
        T.F.TASK_REPEAT.ADD_INFO_PANEL.WEEKLY_CURRENT_WEEKDAY,
        { timeStr: '', weekdayStr: 'Mon' },
        {
          repeatEvery: 1,
          repeatCycle: 'WEEKLY',
          quickSetting: 'WEEKLY_CURRENT_WEEKDAY',
          startDate: '2022-02-24',
          monday: true,
        },
      ],
      [
        T.F.TASK_REPEAT.ADD_INFO_PANEL.WEEKLY_CURRENT_WEEKDAY,
        { timeStr: '', weekdayStr: 'Mon' },
        {
          repeatEvery: 1,
          repeatCycle: 'WEEKLY',
          quickSetting: 'CUSTOM',
          startDate: '2022-02-24',
          monday: true,
        },
      ],
      [
        T.F.TASK_REPEAT.ADD_INFO_PANEL.MONTHLY_CURRENT_DATE,
        { timeStr: '', dateDayStr: '24' },
        {
          repeatEvery: 1,
          repeatCycle: 'MONTHLY',
          quickSetting: 'MONTHLY_CURRENT_DATE',
          startDate: '2022-02-24',
        },
      ],
      [
        T.F.TASK_REPEAT.ADD_INFO_PANEL.MONTHLY_CURRENT_DATE,
        { timeStr: '', dateDayStr: '24' },
        {
          repeatEvery: 1,
          repeatCycle: 'MONTHLY',
          quickSetting: 'CUSTOM',
          startDate: '2022-02-24',
        },
      ],
      [
        T.F.TASK_REPEAT.ADD_INFO_PANEL.YEARLY_CURRENT_DATE,
        { timeStr: '', dayAndMonthStr: '2/24' },
        {
          repeatEvery: 1,
          repeatCycle: 'YEARLY',
          quickSetting: 'YEARLY_CURRENT_DATE',
          startDate: '2022-02-24',
        },
      ],
      [
        T.F.TASK_REPEAT.ADD_INFO_PANEL.YEARLY_CURRENT_DATE,
        { timeStr: '', dayAndMonthStr: '2/24' },
        {
          repeatEvery: 1,
          repeatCycle: 'YEARLY',
          quickSetting: 'CUSTOM',
          startDate: '2022-02-24',
        },
      ],

      [
        T.F.TASK_REPEAT.ADD_INFO_PANEL.EVERY_X_DAILY,
        { timeStr: '', x: 4 },
        {
          repeatEvery: 4,
          repeatCycle: 'DAILY',
          quickSetting: 'CUSTOM',
        },
      ],
      [
        T.F.TASK_REPEAT.ADD_INFO_PANEL.EVERY_X_MONTHLY,
        { timeStr: '', x: 4 },
        {
          repeatEvery: 4,
          repeatCycle: 'MONTHLY',
          quickSetting: 'CUSTOM',
        },
      ],

      [
        T.F.TASK_REPEAT.ADD_INFO_PANEL.CUSTOM_WEEKLY,
        { daysStr: 'Mo, We, Fr', timeStr: '' },
        {
          repeatEvery: 1,
          repeatCycle: 'WEEKLY',
          quickSetting: 'CUSTOM',
          monday: true,
          wednesday: true,
          friday: true,
        },
      ],
    ] as [
      string,
      { [key: string]: string | number } | undefined,
      Partial<TaskRepeatCfg>,
    ][]
  ).forEach(([translationKey, translateParams = { timeStr: '' }, cfg]) => {
    it('should get correct label for cfg', () => {
      expect(
        getTaskRepeatInfoText(
          {
            ...DEFAULT_TASK_REPEAT_CFG,
            monday: false,
            tuesday: false,
            wednesday: false,
            thursday: false,
            friday: false,
            saturday: false,
            sunday: false,
            ...cfg,
            id: 'IDDD',
          },
          'en-US',
        ),
      ).toEqual([translationKey, translateParams]);
    });
  });

  describe('invalid startTime (bug #7067)', () => {
    it('should not throw when startTime is an invalid clock string', () => {
      expect(() =>
        getTaskRepeatInfoText(
          {
            ...DEFAULT_TASK_REPEAT_CFG,
            id: 'IDDD',
            repeatEvery: 1,
            repeatCycle: 'DAILY',
            startTime: 'INVALID_CLOCK_STRING',
          },
          'en-US',
        ),
      ).not.toThrow();
    });

    it('should fall back to no-time label when startTime is invalid', () => {
      const [key, params] = getTaskRepeatInfoText(
        {
          ...DEFAULT_TASK_REPEAT_CFG,
          id: 'IDDD',
          repeatEvery: 1,
          repeatCycle: 'DAILY',
          startTime: 'INVALID_CLOCK_STRING',
        },
        'en-US',
      );
      expect(key).toBe(T.F.TASK_REPEAT.ADD_INFO_PANEL.DAILY);
      expect(params).toEqual({ timeStr: '' });
    });
  });
});
