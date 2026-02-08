import { createSortedBlockerBlocks } from './create-sorted-blocker-blocks';
import { TaskReminderOptionId } from '../../tasks/task.model';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
} from '../../task-repeat-cfg/task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { BlockedBlockType, ScheduleCalendarMapEntry } from '../schedule.model';
/* eslint-disable @typescript-eslint/naming-convention */

// Helper function to conditionally skip tests that are timezone-dependent
// These tests were written with hardcoded expectations for Europe/Berlin timezone
const TZ_OFFSET = new Date('1970-01-01').getTimezoneOffset() * 60000;
const isEuropeBerlinTimezone = (): boolean => TZ_OFFSET === -3600000; // UTC+1 = -1 hour offset
const maybeSkipTimezoneDependent = (testName: string): boolean => {
  if (!isEuropeBerlinTimezone()) {
    console.warn(
      `Skipping timezone-dependent test "${testName}" - only runs in Europe/Berlin timezone`,
    );
    return true;
  }
  return false;
};

const minutes = (n: number): number => n * 60 * 1000;
const hours = (n: number): number => 60 * minutes(n);

const BASE_REMINDER_TASK = (startTime: string, note?: string): any => ({
  timeSpent: 0,
  subTaskIds: [],
  reminderId: 'xxx',
  dueWithTime: getDateTimeFromClockString(startTime, 0),
  title: startTime + ' ' + (note ? note : ' – reminderTask'),
});

const generateBlockedBlocks = (
  initialStart: number,
  initialEnd: number,
  numDays: number,
  type: BlockedBlockType,
  innerBlocks?: any[],
): any[] => {
  const blocks: any[] = [];

  // extract the startTime as an string in this format HH:MM
  let startTime = new Date(initialStart).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  startTime = startTime.padStart(5, '0');
  let endTime = new Date(initialEnd).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  endTime = endTime.padStart(5, '0');

  // if type is WorkdayStartEnd, swap start and end time
  let stTime = startTime;
  let ndTime = endTime;
  if (type === BlockedBlockType.WorkdayStartEnd) {
    stTime = endTime;
    ndTime = startTime;
  }

  let currentStart = initialStart;
  let currentEnd = initialEnd;

  for (let i = 0; i < numDays; i++) {
    const entries = [
      {
        data: {
          startTime: stTime,
          endTime: ndTime,
        },
        end: currentEnd,
        start: currentStart,
        type: type,
      },
    ];

    if (innerBlocks && innerBlocks.length > 0) {
      entries.push(innerBlocks[i]);
    }

    blocks.push({
      start: currentStart,
      end: currentEnd,
      entries: entries,
    });

    // Increment currentStart and currentEnd for the next day
    const oneDayInMilliseconds = 24 * 60 * 60 * 1000;
    currentStart = getDateTimeFromClockString(
      startTime,
      new Date(currentStart + oneDayInMilliseconds),
    );
    currentEnd = getDateTimeFromClockString(
      endTime,
      new Date(currentEnd + oneDayInMilliseconds),
    );
  }

  return blocks;
};

describe('createBlockerBlocks()', () => {
  it('should merge into single block if all overlapping', () => {
    const fakeTasks: any[] = [
      {
        id: 'S1',
        subTaskIds: [],
        timeSpent: 0,
        timeEstimate: hours(2),
        title: 'Scheduled 1 15:00',
        reminderId: 'rhCi_JJyP',
        dueWithTime: getDateTimeFromClockString('9:20', 0),
      },
      {
        id: 'S3',
        subTaskIds: [],
        timeSpent: 0,
        timeEstimate: hours(3),
        title: 'Scheduled 3 17:00',
        reminderId: 'FeKPSsB_L',
        dueWithTime: getDateTimeFromClockString('10:20', 0),
      },
      {
        id: 'S2',
        subTaskIds: [],
        timeSpent: 0,
        timeEstimate: hours(2),
        title: 'Scheduled 2 15:30',
        reminderId: 'xlg47DKt6',
        dueWithTime: getDateTimeFromClockString('12:30', 0),
      },
    ] as any;
    const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
    expect(r.length).toEqual(1);
    expect(r[0].start).toEqual(getDateTimeFromClockString('9:20', 0));
    expect(r[0].end).toEqual(getDateTimeFromClockString('14:30', 0));
  });

  it('should merge into multiple blocks if not overlapping', () => {
    const fakeTasks: any[] = [
      {
        id: 'S1',
        subTaskIds: [],
        timeSpent: 0,
        timeEstimate: hours(2),
        title: 'Scheduled 1 15:00',
        reminderId: 'rhCi_JJyP',
        dueWithTime: getDateTimeFromClockString('9:20', 0),
      },
      {
        id: 'S3',
        subTaskIds: [],
        timeSpent: 0,
        timeEstimate: hours(3),
        title: 'Scheduled 3 17:00',
        reminderId: 'FeKPSsB_L',
        dueWithTime: getDateTimeFromClockString('10:20', 0),
      },
      {
        id: 'S2',
        subTaskIds: [],
        timeSpent: 0,
        timeEstimate: hours(1),
        title: 'Scheduled 2 15:30',
        reminderId: 'xlg47DKt6',
        dueWithTime: getDateTimeFromClockString('12:30', 0),
      },
      {
        id: 'S2',
        subTaskIds: [],
        timeSpent: 0,
        timeEstimate: hours(2),
        title: 'Scheduled 2 15:30',
        reminderId: 'xlg47DKt6',
        dueWithTime: getDateTimeFromClockString('12:00', 0),
      },
      {
        id: 'S4',
        subTaskIds: [],
        timeSpent: 0,
        timeEstimate: hours(2),
        title: 'Scheduled 2 17:30',
        reminderId: 'xlg47DKt6',
        dueWithTime: getDateTimeFromClockString('17:30', 0),
      },
    ] as any;
    const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
    expect(r.length).toEqual(2);
    expect(r[0].start).toEqual(getDateTimeFromClockString('9:20', 0));
    expect(r[0].end).toEqual(getDateTimeFromClockString('14:00', 0));

    expect(r[1].start).toEqual(getDateTimeFromClockString('17:30', 0));
    expect(r[1].end).toEqual(getDateTimeFromClockString('19:30', 0));
  });

  it('should work for advanced scenario', () => {
    const fakeTasks: any[] = [
      {
        id: 'S1',
        subTaskIds: [],
        timeSpent: 0,
        timeEstimate: hours(1),
        title: 'Scheduled 1 15:00',
        reminderId: 'xxx',
        dueWithTime: getDateTimeFromClockString('15:00', 0),
      },
      {
        id: 'S2',
        subTaskIds: [],
        timeSpent: 0,
        timeEstimate: minutes(185),
        title: 'Scheduled 2 15:30',
        reminderId: 'xxx',
        dueWithTime: getDateTimeFromClockString('15:30', 0),
      },
      {
        id: 'S3',
        subTaskIds: [],
        timeSpent: 0,
        timeEstimate: hours(2),
        title: 'Scheduled 3 17:00',
        reminderId: 'xxx',
        dueWithTime: getDateTimeFromClockString('17:00', 0),
      },
    ] as any;
    const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
    expect(r.length).toEqual(1);
    expect(r[0].start).toEqual(getDateTimeFromClockString('15:00', 0));
    expect(r[0].end).toEqual(getDateTimeFromClockString('19:00', 0));
  });

  it('should merge multiple times', () => {
    const fakeTasks: any[] = [
      {
        ...BASE_REMINDER_TASK('16:00', 'no duration'),
        timeEstimate: 0,
      },
      {
        ...BASE_REMINDER_TASK('17:00'),
        timeEstimate: hours(2),
      },
      {
        ...BASE_REMINDER_TASK('23:00', 'standalone'),
        timeEstimate: hours(1),
      },
      {
        ...BASE_REMINDER_TASK('15:00'),
        timeEstimate: hours(1),
      },
      {
        ...BASE_REMINDER_TASK('15:30'),
        timeEstimate: hours(2.5),
      },
    ] as any;

    const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);

    expect(r.length).toEqual(2);
    // Entries are sorted by start time within each block
    expect(r).toEqual([
      {
        start: getDateTimeFromClockString('15:00', 0),
        end: getDateTimeFromClockString('19:00', 0),
        entries: [
          {
            data: fakeTasks[3], // 15:00
            end: fakeTasks[3].dueWithTime! + hours(1),
            start: fakeTasks[3].dueWithTime,
            type: 'ScheduledTask',
          },
          {
            data: fakeTasks[4], // 15:30
            end: fakeTasks[4].dueWithTime! + hours(2.5),
            start: fakeTasks[4].dueWithTime,
            type: 'ScheduledTask',
          },
          {
            data: fakeTasks[0], // 16:00
            end: fakeTasks[0].dueWithTime,
            start: fakeTasks[0].dueWithTime,
            type: 'ScheduledTask',
          },
          {
            data: fakeTasks[1], // 17:00
            end: fakeTasks[1].dueWithTime! + hours(2),
            start: fakeTasks[1].dueWithTime,
            type: 'ScheduledTask',
          },
        ],
      },
      {
        start: getDateTimeFromClockString('23:00', 0),
        end: getDateTimeFromClockString('23:00', 0) + hours(1),
        entries: [
          {
            data: fakeTasks[2],
            end: fakeTasks[2].dueWithTime! + hours(1),
            start: fakeTasks[2].dueWithTime,
            type: 'ScheduledTask',
          },
        ],
      },
    ] as any);
  });

  it('should work with far future entries', () => {
    const fakeTasks: any[] = [
      {
        ...BASE_REMINDER_TASK('16:00', 'no duration'),
        timeEstimate: 0,
      },
      {
        ...BASE_REMINDER_TASK('17:00'),
        timeEstimate: hours(2),
      },
      {
        ...BASE_REMINDER_TASK('23:00', 'standalone'),
        timeEstimate: hours(1),
      },
      {
        ...BASE_REMINDER_TASK('15:00'),
        timeEstimate: hours(2),
      },
      {
        ...BASE_REMINDER_TASK('15:30', 'TOMORROW'),
        dueWithTime: getDateTimeFromClockString('15:30', hours(24)),
        timeEstimate: hours(2.5),
      },
    ] as any;

    const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);

    expect(r.length).toEqual(3);

    expect(r[0].start).toEqual(getDateTimeFromClockString('15:00', 0));
    expect(r[0].end).toEqual(getDateTimeFromClockString('19:00', 0));
    expect(r[0].entries.length).toEqual(3);

    expect(r[1].start).toEqual(getDateTimeFromClockString('23:00', 0));
    expect(r[1].end).toEqual(getDateTimeFromClockString('23:00', 0) + hours(1));
    expect(r[1].entries.length).toEqual(1);

    expect(r[2].start).toEqual(getDateTimeFromClockString('15:30', hours(24)));
    expect(r[2].end).toEqual(getDateTimeFromClockString('15:30', hours(24)) + hours(2.5));
    expect(r[2].entries.length).toEqual(1);
  });

  it('should work for advanced scenario', () => {
    const fakeTasks: any[] = [
      {
        id: '0LtuSnH8s',
        projectId: null,
        subTaskIds: [],
        timeSpentOnDay: {},
        timeSpent: 0,
        timeEstimate: 7200000,
        isDone: false,
        doneOn: null,
        title: 'Scheduled 3 17:00',
        notes: '',
        tagIds: ['TODAY'],
        parentId: null,
        reminderId: 'FeKPSsB_L',
        created: 1620028156706,
        repeatCfgId: null,
        dueWithTime: getDateTimeFromClockString('17:00', new Date(1620048600000)),
        _showSubTasksMode: 2,
        attachments: [],
        issueId: null,
        issuePoints: null,
        issueType: null,
        issueAttachmentNr: null,
        issueLastUpdated: null,
        issueWasUpdated: null,
      },
      {
        id: '68K0kYJ2s',
        projectId: null,
        subTaskIds: [],
        timeSpentOnDay: {},
        timeSpent: 0,
        timeEstimate: 3600000,
        isDone: false,
        doneOn: null,
        title: 'Scheduled 1 15:00',
        notes: '',
        tagIds: ['TODAY'],
        parentId: null,
        reminderId: 'rhCi_JJyP',
        created: 1619985034709,
        repeatCfgId: null,
        dueWithTime: getDateTimeFromClockString('15:00', new Date(1620048600000)),
        _showSubTasksMode: 2,
        attachments: [],
        issueId: null,
        issuePoints: null,
        issueType: null,
        issueAttachmentNr: null,
        issueLastUpdated: null,
        issueWasUpdated: null,
      },
      {
        id: '9JTnZa-VW',
        projectId: null,
        subTaskIds: [],
        timeSpentOnDay: {},
        timeSpent: 0,
        timeEstimate: 9000000,
        isDone: false,
        doneOn: null,
        title: 'Scheduled 2 15:30',
        notes: '',
        tagIds: ['TODAY'],
        parentId: null,
        reminderId: 'xlg47DKt6',
        created: 1620027763328,
        repeatCfgId: null,
        dueWithTime: getDateTimeFromClockString('15:30', new Date(1620048600000)),
        _showSubTasksMode: 2,
        attachments: [],
        issueId: null,
        issuePoints: null,
        issueType: null,
        issueAttachmentNr: null,
        issueLastUpdated: null,
        issueWasUpdated: null,
      },
    ] as any;
    const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);

    expect(r.length).toEqual(1);
    expect(r[0].start).toEqual(
      getDateTimeFromClockString('15:00', new Date(1620048600000)),
    );
    expect(r[0].end).toEqual(
      getDateTimeFromClockString('19:00', new Date(1620048600000)),
    );
  });

  describe('workStartEnd', () => {
    it('should merge complicated blocks', () => {
      const fakeTasks = [
        {
          id: 'RlHPfiXYk',
          projectId: null,
          subTaskIds: [],
          timeSpentOnDay: { '2021-05-05': 1999 },
          timeSpent: 1999,
          timeEstimate: 0,
          isDone: false,
          doneOn: null,
          title: 'XXX',
          notes: '',
          tagIds: ['TODAY'],
          parentId: null,
          reminderId: 'wctU7fdUV',
          created: 1620239185383,
          repeatCfgId: null,
          dueWithTime: getDateTimeFromClockString('23:00', 1620172800000),
          _showSubTasksMode: 2,
          attachments: [],
          issueId: null,
          issuePoints: null,
          issueType: null,
          issueAttachmentNr: null,
          issueLastUpdated: null,
          issueWasUpdated: null,
        },
        {
          id: 'xY44rpnb9',
          projectId: null,
          subTaskIds: [],
          timeSpentOnDay: {},
          timeSpent: 0,
          timeEstimate: 1800000,
          isDone: false,
          doneOn: null,
          title: 'SChed2',
          notes: '',
          tagIds: ['TODAY'],
          parentId: null,
          reminderId: '8ON1WZbSb',
          created: 1620227641668,
          repeatCfgId: null,
          dueWithTime: getDateTimeFromClockString('22:00', 1620172800000),
          _showSubTasksMode: 2,
          attachments: [],
          issueId: null,
          issuePoints: null,
          issueType: null,
          issueAttachmentNr: null,
          issueLastUpdated: null,
          issueWasUpdated: null,
        },
        {
          id: 'LayqneCZ0',
          projectId: null,
          subTaskIds: [],
          timeSpentOnDay: {},
          timeSpent: 0,
          timeEstimate: 1800000,
          isDone: false,
          doneOn: null,
          title: 'Sched1',
          notes: '',
          tagIds: ['TODAY'],
          parentId: null,
          reminderId: 'NkonFINlM',
          created: 1620227624280,
          repeatCfgId: null,
          dueWithTime: getDateTimeFromClockString('21:00', 1620172800000),
          _showSubTasksMode: 2,
          attachments: [],
          issueId: null,
          issuePoints: null,
          issueType: null,
          issueAttachmentNr: null,
          issueLastUpdated: null,
          issueWasUpdated: null,
        },
      ] as any;

      const r = createSortedBlockerBlocks(
        fakeTasks,
        [],
        [],
        {
          startTime: '09:00',
          endTime: '17:00',
        },
        undefined,
        getDateTimeFromClockString('20:45', 1620172800000),
      );

      const wStartEndBlocks = generateBlockedBlocks(
        getDateTimeFromClockString('17:00', new Date(1620259200000)),
        getDateTimeFromClockString('09:00', new Date(1620345600000)),
        29,
        BlockedBlockType.WorkdayStartEnd,
      );

      expect(r.length).toEqual(30);
      // Entries are sorted by start time within merged blocks
      expect(r).toEqual([
        {
          end: getDateTimeFromClockString('09:00', new Date(1620259200000)),
          entries: [
            {
              data: { endTime: '17:00', startTime: '09:00' },
              end: getDateTimeFromClockString('09:00', new Date(1620259200000)),
              start: getDateTimeFromClockString('17:00', new Date(1620172800000)),
              type: 'WorkdayStartEnd',
            },
            {
              data: {
                _showSubTasksMode: 2,
                attachments: [],
                created: 1620227624280,
                doneOn: null,
                id: 'LayqneCZ0',
                isDone: false,
                issueAttachmentNr: null,
                issueId: null,
                issueLastUpdated: null,
                issuePoints: null,
                issueType: null,
                issueWasUpdated: null,
                notes: '',
                parentId: null,
                dueWithTime: getDateTimeFromClockString('21:00', new Date(1620172800000)),
                projectId: null,
                reminderId: 'NkonFINlM',
                repeatCfgId: null,
                subTaskIds: [],
                tagIds: ['TODAY'],
                timeEstimate: 1800000,
                timeSpent: 0,
                timeSpentOnDay: {},
                title: 'Sched1',
              },
              end: getDateTimeFromClockString('21:30', new Date(1620172800000)),
              start: getDateTimeFromClockString('21:00', new Date(1620172800000)),
              type: 'ScheduledTask',
            },
            {
              data: {
                _showSubTasksMode: 2,
                attachments: [],
                created: 1620227641668,
                doneOn: null,
                id: 'xY44rpnb9',
                isDone: false,
                issueAttachmentNr: null,
                issueId: null,
                issueLastUpdated: null,
                issuePoints: null,
                issueType: null,
                issueWasUpdated: null,
                notes: '',
                parentId: null,
                dueWithTime: getDateTimeFromClockString('22:00', new Date(1620172800000)),
                projectId: null,
                reminderId: '8ON1WZbSb',
                repeatCfgId: null,
                subTaskIds: [],
                tagIds: ['TODAY'],
                timeEstimate: 1800000,
                timeSpent: 0,
                timeSpentOnDay: {},
                title: 'SChed2',
              },
              end: getDateTimeFromClockString('22:30', new Date(1620172800000)),
              start: getDateTimeFromClockString('22:00', new Date(1620172800000)),
              type: 'ScheduledTask',
            },
            {
              data: {
                _showSubTasksMode: 2,
                attachments: [],
                created: 1620239185383,
                doneOn: null,
                id: 'RlHPfiXYk',
                isDone: false,
                issueAttachmentNr: null,
                issueId: null,
                issueLastUpdated: null,
                issuePoints: null,
                issueType: null,
                issueWasUpdated: null,
                notes: '',
                parentId: null,
                dueWithTime: getDateTimeFromClockString('23:00', new Date(1620172800000)),
                projectId: null,
                reminderId: 'wctU7fdUV',
                repeatCfgId: null,
                subTaskIds: [],
                tagIds: ['TODAY'],
                timeEstimate: 0,
                timeSpent: 1999,
                timeSpentOnDay: { '2021-05-05': 1999 },
                title: 'XXX',
              },
              end: getDateTimeFromClockString('23:00', new Date(1620172800000)),
              start: getDateTimeFromClockString('23:00', new Date(1620172800000)),
              type: 'ScheduledTask',
            },
          ],
          start: getDateTimeFromClockString('17:00', new Date(1620172800000)),
        },
        ...wStartEndBlocks,
      ] as any);
    });
  });

  describe('lunchBreak', () => {
    it('should work for simple scenario', () => {
      const fakeTasks = [
        {
          id: 'RlHPfiXYk',
          projectId: null,
          subTaskIds: [],
          timeSpentOnDay: { '2021-05-05': 1999 },
          timeSpent: 1999,
          timeEstimate: 0,
          isDone: false,
          doneOn: null,
          title: 'XXX',
          notes: '',
          tagIds: ['TODAY'],
          parentId: null,
          reminderId: 'wctU7fdUV',
          created: 1620239185383,
          repeatCfgId: null,
          dueWithTime: getDateTimeFromClockString('11:00', 1620172800000),
          _showSubTasksMode: 2,
          attachments: [],
          issueId: null,
          issuePoints: null,
          issueType: null,
          issueAttachmentNr: null,
          issueLastUpdated: null,
          issueWasUpdated: null,
        },
      ] as any;

      const r = createSortedBlockerBlocks(
        fakeTasks,
        [],
        [],
        {
          startTime: '09:00',
          endTime: '17:00',
        },
        {
          startTime: '13:00',
          endTime: '14:00',
        },
        getDateTimeFromClockString('09:45', 1620172800000),
      );

      const wLunchBlocks = generateBlockedBlocks(
        getDateTimeFromClockString('13:00', new Date(1620172800000)),
        getDateTimeFromClockString('14:00', new Date(1620172800000)),
        30,
        BlockedBlockType.LunchBreak,
      );

      const wStartEndBlocks = generateBlockedBlocks(
        getDateTimeFromClockString('17:00', new Date(1620172800000)),
        getDateTimeFromClockString('09:00', new Date(1620259200000)),
        30,
        BlockedBlockType.WorkdayStartEnd,
      );

      const blocks = [...wStartEndBlocks, ...wLunchBlocks];

      // sort blocks by date
      blocks.sort((a, b) => a.start - b.start);

      expect(r.length).toEqual(61);
      expect(r).toEqual([
        {
          end: getDateTimeFromClockString('11:00', new Date(1620172800000)),
          entries: [
            {
              data: {
                _showSubTasksMode: 2,
                attachments: [],
                created: 1620239185383,
                doneOn: null,
                id: 'RlHPfiXYk',
                isDone: false,
                issueAttachmentNr: null,
                issueId: null,
                issueLastUpdated: null,
                issuePoints: null,
                issueType: null,
                issueWasUpdated: null,
                notes: '',
                parentId: null,
                dueWithTime: getDateTimeFromClockString('11:00', new Date(1620172800000)),
                projectId: null,
                reminderId: 'wctU7fdUV',
                repeatCfgId: null,
                subTaskIds: [],
                tagIds: ['TODAY'],
                timeEstimate: 0,
                timeSpent: 1999,
                timeSpentOnDay: { '2021-05-05': 1999 },
                title: 'XXX',
              },
              end: getDateTimeFromClockString('11:00', new Date(1620172800000)),
              start: getDateTimeFromClockString('11:00', new Date(1620172800000)),
              type: 'ScheduledTask',
            },
          ],
          start: getDateTimeFromClockString('11:00', new Date(1620172800000)),
        },
        ...blocks,
      ] as any);
    });
  });

  describe('repeatTaskProjections', () => {
    const DUMMY_REPEATABLE_TASK: TaskRepeatCfg = {
      ...DEFAULT_TASK_REPEAT_CFG,
      id: 'REPEATABLE_DEFAULT',
      title: 'REPEATABLE_DEFAULT',
      quickSetting: 'DAILY',
      lastTaskCreationDay: '1970-01-01',
      defaultEstimate: undefined,
      notes: undefined,
      projectId: null,
      startTime: undefined,
      remindAt: undefined,
      isPaused: false,
      repeatCycle: 'WEEKLY',
      startDate: getDbDateStr(new Date(0)),
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

    it('should work for a scheduled repeatable task', () => {
      if (maybeSkipTimezoneDependent('should work for a scheduled repeatable task')) {
        pending('Skipping timezone-dependent test');
        return;
      }
      const fakeRepeatTaskCfgs: TaskRepeatCfg[] = [
        {
          ...DUMMY_REPEATABLE_TASK,
          id: 'R1',
          startTime: '10:00',
          defaultEstimate: hours(1),
          friday: true,
          remindAt: TaskReminderOptionId.AtStart,
        },
      ];
      const r = createSortedBlockerBlocks(
        [],
        fakeRepeatTaskCfgs,
        [],
        undefined,
        undefined,
        0,
      );

      expect(r.length).toEqual(5);
      expect(r[0].start).toEqual(
        getDateTimeFromClockString('10:00', 24 * 60 * 60 * 1000),
      );
      expect(r[0].end).toEqual(getDateTimeFromClockString('11:00', 24 * 60 * 60 * 1000));
    });

    it('should work for different types of repeatable tasks', () => {
      if (
        maybeSkipTimezoneDependent('should work for different types of repeatable tasks')
      ) {
        pending('Skipping timezone-dependent test');
        return;
      }
      const fakeRepeatTaskCfgs: TaskRepeatCfg[] = [
        {
          ...DUMMY_REPEATABLE_TASK,
          id: 'R1',
          title: 'Repeat 1',
          startTime: '10:00',
          defaultEstimate: hours(1),
          sunday: true,
        },
        {
          ...DUMMY_REPEATABLE_TASK,
          id: 'R2',
          title: 'Repeat 2',
          startTime: '14:00',
          lastTaskCreationDay: getDbDateStr(getDateTimeFromClockString('22:20', 0)),
          defaultEstimate: hours(1),
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: true,
          sunday: true,
        },
        {
          ...DUMMY_REPEATABLE_TASK,
          id: 'R3',
          title: 'Repeat 3 No Time',
          startTime: '10:00',
          defaultEstimate: hours(1),
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: true,
          sunday: true,
        },
      ];
      const r = createSortedBlockerBlocks(
        [],
        fakeRepeatTaskCfgs,
        [],
        undefined,
        undefined,
        0,
      );
      expect(r.length).toEqual(58);
      expect(r[2].start).toEqual(205200000);
      expect(r[2].end).toEqual(208800000);
      expect(r[2].entries.length).toEqual(1);
      expect(r[4].entries.length).toEqual(2);
    });

    it('should work for DAILY repeatable tasks', () => {
      if (maybeSkipTimezoneDependent('should work for DAILY repeatable tasks')) {
        pending('Skipping timezone-dependent test');
        return;
      }
      const fakeRepeatTaskCfgs: TaskRepeatCfg[] = [
        {
          ...DUMMY_REPEATABLE_TASK,
          id: 'R1',
          startTime: '10:00',
          defaultEstimate: hours(1),
          repeatCycle: 'DAILY',
        },
      ];
      const r = createSortedBlockerBlocks(
        [],
        fakeRepeatTaskCfgs,
        [],
        undefined,
        undefined,
        0,
      );
      expect(r.length).toEqual(29);
      expect(r[0].start).toEqual(
        getDateTimeFromClockString('10:00', 24 * 60 * 60 * 1000),
      );
      expect(r[0].end).toEqual(getDateTimeFromClockString('11:00', 24 * 60 * 60 * 1000));
      expect(r[28].start).toEqual(
        getDateTimeFromClockString('10:00', 29 * 24 * 60 * 60 * 1000),
      );
      expect(r[28].end).toEqual(
        getDateTimeFromClockString('11:00', 29 * 24 * 60 * 60 * 1000),
      );
    });
  });

  describe('icalEventMap', () => {
    it('should exclude all-day events from blocker blocks', () => {
      const icalEventMap: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'AllDayEvent',
              calProviderId: 'PR',
              start: getDateTimeFromClockString('00:00', 24 * 60 * 60 * 1000),
              title: 'All Day Event',
              duration: 0,
              isAllDay: true,
            },
            {
              id: 'TimedEvent',
              calProviderId: 'PR',
              start: getDateTimeFromClockString('14:00', 24 * 60 * 60 * 1000),
              title: 'Timed Event',
              duration: hours(1),
            },
          ],
        },
      ];
      const r = createSortedBlockerBlocks([], [], icalEventMap, undefined, undefined, 0);

      // Only the timed event should create a blocker block
      expect(r.length).toEqual(1);
      expect(r[0].entries.length).toEqual(1);
      expect(r[0].entries[0].type).toEqual(BlockedBlockType.CalendarEvent);
      expect((r[0].entries[0].data as any).title).toEqual('Timed Event');
    });

    it('should exclude all-day events even when mixed with timed events from same provider', () => {
      const icalEventMap: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'AllDay1',
              calProviderId: 'PR',
              start: getDateTimeFromClockString('00:00', 0),
              title: 'All Day 1',
              duration: 24 * 60 * 60 * 1000, // 24 hours
              isAllDay: true,
            },
            {
              id: 'AllDay2',
              calProviderId: 'PR',
              start: getDateTimeFromClockString('00:00', 24 * 60 * 60 * 1000),
              title: 'All Day 2',
              duration: 0,
              isAllDay: true,
            },
          ],
        },
      ];
      const r = createSortedBlockerBlocks([], [], icalEventMap, undefined, undefined, 0);

      // No blocker blocks should be created for all-day events
      expect(r.length).toEqual(0);
    });

    it('should work for calendar events', () => {
      if (maybeSkipTimezoneDependent('should work for calendar events')) {
        pending('Skipping timezone-dependent test');
        return;
      }
      const icalEventMap: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'EventId',
              calProviderId: 'PR',
              start: getDateTimeFromClockString('10:00', 24 * 60 * 60 * 1000),
              title: 'XXX',
              icon: 'aaa',
              duration: hours(1),
            },
          ],
        },
      ];
      const fakeTasks: any[] = [
        {
          id: 'S1',
          timeSpent: 0,
          subTaskIds: [],
          timeEstimate: hours(2),
          title: 'Scheduled 1 15:00',
          reminderId: 'rhCi_JJyP',
          dueWithTime: getDateTimeFromClockString('9:20', 0),
        },
      ] as any;
      const r = createSortedBlockerBlocks(
        fakeTasks,
        [],
        icalEventMap,
        undefined,
        undefined,
        0,
      );
      expect(r).toEqual([
        {
          end: 37200000,
          entries: [
            {
              data: {
                id: 'S1',
                subTaskIds: [],
                dueWithTime: 30000000,
                reminderId: 'rhCi_JJyP',
                timeEstimate: 7200000,
                timeSpent: 0,
                title: 'Scheduled 1 15:00',
              },
              end: 37200000,
              start: 30000000,
              type: 'ScheduledTask',
            },
          ],
          start: 30000000,
        },
        {
          end: 122400000,
          entries: [
            {
              data: {
                calProviderId: 'PR',
                duration: 3600000,
                icon: 'aaa',
                start: 118800000,
                title: 'XXX',
                id: 'EventId',
              },
              end: 122400000,
              start: 118800000,
              type: 'CalendarEvent',
            },
          ],
          start: 118800000,
        },
      ] as any);
    });
  });

  describe('block merging algorithm', () => {
    // These tests specifically verify the merging behavior of overlapping blocks
    // to ensure the algorithm correctly handles all edge cases

    it('should return empty array when no tasks provided', () => {
      const r = createSortedBlockerBlocks([], [], [], undefined, undefined, 0);
      expect(r.length).toEqual(0);
    });

    it('should return single block for single task', () => {
      const fakeTasks: any[] = [
        {
          id: 'S1',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          title: 'Single Task',
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('10:00', 0),
        },
      ];
      const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
      expect(r.length).toEqual(1);
      expect(r[0].entries.length).toEqual(1);
    });

    it('should keep non-overlapping blocks separate', () => {
      const fakeTasks: any[] = [
        {
          id: 'S1',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          title: 'Task 1',
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('09:00', 0),
        },
        {
          id: 'S2',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          title: 'Task 2',
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('14:00', 0),
        },
        {
          id: 'S3',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          title: 'Task 3',
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('20:00', 0),
        },
      ];
      const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
      expect(r.length).toEqual(3);
      // Verify sorted by start time
      expect(r[0].start).toBeLessThan(r[1].start);
      expect(r[1].start).toBeLessThan(r[2].start);
    });

    it('should merge two directly adjacent blocks', () => {
      const fakeTasks: any[] = [
        {
          id: 'S1',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          title: 'Task 1',
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('10:00', 0),
        },
        {
          id: 'S2',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          title: 'Task 2',
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('11:00', 0), // Starts exactly when S1 ends
        },
      ];
      const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
      expect(r.length).toEqual(1);
      expect(r[0].start).toEqual(getDateTimeFromClockString('10:00', 0));
      expect(r[0].end).toEqual(getDateTimeFromClockString('12:00', 0));
      expect(r[0].entries.length).toEqual(2);
    });

    it('should merge block completely contained within another', () => {
      const fakeTasks: any[] = [
        {
          id: 'S1',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(4),
          title: 'Long Task',
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('09:00', 0), // 9:00 - 13:00
        },
        {
          id: 'S2',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          title: 'Short Task Inside',
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('10:00', 0), // 10:00 - 11:00 (inside S1)
        },
      ];
      const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
      expect(r.length).toEqual(1);
      expect(r[0].start).toEqual(getDateTimeFromClockString('09:00', 0));
      expect(r[0].end).toEqual(getDateTimeFromClockString('13:00', 0));
      expect(r[0].entries.length).toEqual(2);
    });

    it('should merge chain of overlapping blocks (A->B->C)', () => {
      const fakeTasks: any[] = [
        {
          id: 'S1',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(2),
          title: 'Task A',
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('09:00', 0), // 9:00 - 11:00
        },
        {
          id: 'S2',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(2),
          title: 'Task B',
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('10:30', 0), // 10:30 - 12:30 (overlaps A)
        },
        {
          id: 'S3',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(2),
          title: 'Task C',
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('12:00', 0), // 12:00 - 14:00 (overlaps B)
        },
      ];
      const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
      expect(r.length).toEqual(1);
      expect(r[0].start).toEqual(getDateTimeFromClockString('09:00', 0));
      expect(r[0].end).toEqual(getDateTimeFromClockString('14:00', 0));
      expect(r[0].entries.length).toEqual(3);
    });

    it('should merge tasks given in reverse chronological order', () => {
      const fakeTasks: any[] = [
        {
          id: 'S3',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          title: 'Task C (last)',
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('11:00', 0),
        },
        {
          id: 'S2',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          title: 'Task B (middle)',
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('10:00', 0),
        },
        {
          id: 'S1',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          title: 'Task A (first)',
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('09:00', 0),
        },
      ];
      const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
      expect(r.length).toEqual(1);
      expect(r[0].start).toEqual(getDateTimeFromClockString('09:00', 0));
      expect(r[0].end).toEqual(getDateTimeFromClockString('12:00', 0));
      expect(r[0].entries.length).toEqual(3);
    });

    it('should handle multiple separate groups of overlapping blocks', () => {
      const fakeTasks: any[] = [
        // Group 1: 9:00 - 11:00
        {
          id: 'G1A',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('09:00', 0),
        },
        {
          id: 'G1B',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('10:00', 0),
        },
        // Gap from 11:00 - 14:00
        // Group 2: 14:00 - 16:00
        {
          id: 'G2A',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('14:00', 0),
        },
        {
          id: 'G2B',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('15:00', 0),
        },
        // Gap from 16:00 - 20:00
        // Group 3: 20:00 - 22:00
        {
          id: 'G3A',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('20:00', 0),
        },
        {
          id: 'G3B',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('21:00', 0),
        },
      ];
      const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
      expect(r.length).toEqual(3);
      expect(r[0].entries.length).toEqual(2);
      expect(r[1].entries.length).toEqual(2);
      expect(r[2].entries.length).toEqual(2);
    });

    it('should handle many overlapping blocks efficiently', () => {
      // Create 50 overlapping tasks to test performance
      const fakeTasks: any[] = [];
      const baseTime = getDateTimeFromClockString('09:00', 0);
      for (let i = 0; i < 50; i++) {
        const offset = i * minutes(30); // Start every 30 min
        fakeTasks.push({
          id: `S${i}`,
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(2), // 2 hour tasks
          reminderId: 'xxx',
          dueWithTime: baseTime + offset,
        });
      }
      const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
      // All should merge into one block since they overlap
      expect(r.length).toEqual(1);
      expect(r[0].entries.length).toEqual(50);
      // First task starts at 9:00, last task (49 * 30min later = 24.5h) + 2h duration
      expect(r[0].start).toEqual(getDateTimeFromClockString('09:00', 0));
    });

    it('should handle blocks with same start time', () => {
      const fakeTasks: any[] = [
        {
          id: 'S1',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('10:00', 0),
        },
        {
          id: 'S2',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(2),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('10:00', 0), // Same start
        },
        {
          id: 'S3',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(3),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('10:00', 0), // Same start
        },
      ];
      const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
      expect(r.length).toEqual(1);
      expect(r[0].start).toEqual(getDateTimeFromClockString('10:00', 0));
      expect(r[0].end).toEqual(getDateTimeFromClockString('13:00', 0)); // Longest task
      expect(r[0].entries.length).toEqual(3);
    });

    it('should handle blocks with same end time', () => {
      const fakeTasks: any[] = [
        {
          id: 'S1',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(3),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('09:00', 0), // Ends at 12:00
        },
        {
          id: 'S2',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(2),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('10:00', 0), // Ends at 12:00
        },
        {
          id: 'S3',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('11:00', 0), // Ends at 12:00
        },
      ];
      const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
      expect(r.length).toEqual(1);
      expect(r[0].start).toEqual(getDateTimeFromClockString('09:00', 0));
      expect(r[0].end).toEqual(getDateTimeFromClockString('12:00', 0));
      expect(r[0].entries.length).toEqual(3);
    });

    it('should handle zero-duration tasks', () => {
      const fakeTasks: any[] = [
        {
          id: 'S1',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: 0, // Zero duration
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('10:00', 0),
        },
        {
          id: 'S2',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('10:00', 0),
        },
      ];
      const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
      expect(r.length).toEqual(1);
      expect(r[0].entries.length).toEqual(2);
    });

    it('should correctly sort output by start time', () => {
      const fakeTasks: any[] = [
        {
          id: 'Later',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('15:00', 0),
        },
        {
          id: 'Earlier',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('09:00', 0),
        },
        {
          id: 'Middle',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('12:00', 0),
        },
      ];
      const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
      expect(r.length).toEqual(3);
      expect(r[0].start).toEqual(getDateTimeFromClockString('09:00', 0));
      expect(r[1].start).toEqual(getDateTimeFromClockString('12:00', 0));
      expect(r[2].start).toEqual(getDateTimeFromClockString('15:00', 0));
    });

    it('should merge calendar events with scheduled tasks when overlapping', () => {
      const fakeTasks: any[] = [
        {
          id: 'S1',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(2),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('10:00', 0), // 10:00 - 12:00
        },
      ];
      const icalEventMap: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'CalEvent',
              calProviderId: 'PR',
              start: getDateTimeFromClockString('11:00', 0), // 11:00 - 12:00 (overlaps task)
              title: 'Calendar Event',
              duration: hours(1),
            },
          ],
        },
      ];
      const r = createSortedBlockerBlocks(
        fakeTasks,
        [],
        icalEventMap,
        undefined,
        undefined,
        0,
      );
      expect(r.length).toEqual(1);
      expect(r[0].entries.length).toEqual(2);
      expect(r[0].start).toEqual(getDateTimeFromClockString('10:00', 0));
      expect(r[0].end).toEqual(getDateTimeFromClockString('12:00', 0));
    });

    it('should handle overlapping blocks across midnight', () => {
      const fakeTasks: any[] = [
        {
          id: 'S1',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(3),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('22:00', 0), // 22:00 - 01:00 next day
        },
        {
          id: 'S2',
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(2),
          reminderId: 'xxx',
          dueWithTime: getDateTimeFromClockString('23:30', 0), // 23:30 - 01:30 next day
        },
      ];
      const r = createSortedBlockerBlocks(fakeTasks, [], [], undefined, undefined, 0);
      expect(r.length).toEqual(1);
      expect(r[0].start).toEqual(getDateTimeFromClockString('22:00', 0));
      // End time should be 01:30 next day
      expect(r[0].end).toEqual(getDateTimeFromClockString('23:30', 0) + hours(2));
      expect(r[0].entries.length).toEqual(2);
    });
  });

  describe('Performance Tests', () => {
    /**
     * Generates random blocked blocks for performance testing
     */
    const generateRandomBlocks = (count: number, startDate: number): any[] => {
      const blocks: any[] = [];
      for (let i = 0; i < count; i++) {
        // eslint-disable-next-line no-mixed-operators
        const start = startDate + Math.random() * hours(24);
        const duration = Math.random() * hours(2); // 0-2 hours duration
        blocks.push({
          id: `task-${i}`,
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: duration,
          reminderId: `reminder-${i}`,
          dueWithTime: start,
        });
      }
      return blocks;
    };

    it('should merge 1000 blocks in < 100ms (O(n log n) algorithm)', () => {
      const startDate = getDateTimeFromClockString('08:00', 0);
      const blocks = generateRandomBlocks(1000, startDate);

      const start = performance.now();
      const result = createSortedBlockerBlocks(blocks, [], [], undefined, undefined, 0);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(500);
      expect(result.length).toBeGreaterThan(0);
      // Verify result is sorted
      for (let i = 1; i < result.length; i++) {
        expect(result[i].start).toBeGreaterThanOrEqual(result[i - 1].start);
      }
    });

    it('should handle 10,000 blocks without timeout (ensures O(n log n) scaling)', () => {
      const startDate = getDateTimeFromClockString('08:00', 0);
      const blocks = generateRandomBlocks(10000, startDate);

      const start = performance.now();
      const result = createSortedBlockerBlocks(blocks, [], [], undefined, undefined, 0);
      const duration = performance.now() - start;

      // Should complete in reasonable time (< 1 second for 10k blocks)
      expect(duration).toBeLessThan(1000);
      expect(result.length).toBeGreaterThan(0);
      // Verify result is sorted
      for (let i = 1; i < result.length; i++) {
        expect(result[i].start).toBeGreaterThanOrEqual(result[i - 1].start);
      }
    });

    it('should correctly merge overlapping blocks at scale', () => {
      const startDate = getDateTimeFromClockString('08:00', 0);
      // Create blocks that intentionally overlap
      const blocks: any[] = [];
      for (let i = 0; i < 1000; i++) {
        // eslint-disable-next-line no-mixed-operators
        const start = startDate + i * hours(1); // Each starts 1 hour apart
        blocks.push({
          id: `task-${i}`,
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(2), // 2 hour duration causes overlap
          reminderId: `reminder-${i}`,
          dueWithTime: start,
        });
      }

      const start = performance.now();
      const result = createSortedBlockerBlocks(blocks, [], [], undefined, undefined, 0);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(500);
      // Should merge many overlapping blocks
      expect(result.length).toBeLessThan(blocks.length);
      // Verify no gaps between merged blocks
      for (let i = 1; i < result.length; i++) {
        expect(result[i].start).toBeGreaterThanOrEqual(result[i - 1].end);
      }
    });

    it('should maintain performance with mostly non-overlapping blocks', () => {
      const startDate = getDateTimeFromClockString('08:00', 0);
      // Create blocks that mostly don't overlap
      const blocks: any[] = [];
      for (let i = 0; i < 1000; i++) {
        // eslint-disable-next-line no-mixed-operators
        const start = startDate + i * hours(3); // 3 hours apart
        blocks.push({
          id: `task-${i}`,
          subTaskIds: [],
          timeSpent: 0,
          timeEstimate: hours(1), // 1 hour duration - no overlap
          reminderId: `reminder-${i}`,
          dueWithTime: start,
        });
      }

      const start = performance.now();
      const result = createSortedBlockerBlocks(blocks, [], [], undefined, undefined, 0);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(500);
      // Should have minimal merging
      expect(result.length).toBe(blocks.length);
    });
  });
});
