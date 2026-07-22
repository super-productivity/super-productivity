import { TaskCopy } from './task.model';
import {
  shortSyntax,
  parseTimeSpentChanges,
  ShortSyntaxRange,
  ShortSyntaxTokenType,
} from './short-syntax';
import { getDbDateStr } from '../../util/get-db-date-str';
import {
  MONTH_SHORT_NAMES,
  oneDayInMilliseconds,
} from '../../util/month-time-conversion';
import { Tag } from '../tag/tag.model';
import { DEFAULT_TAG } from '../tag/tag.const';
import { Project } from '../project/project.model';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { INBOX_PROJECT } from '../project/project.const';

const TASK: TaskCopy = {
  id: 'id',
  projectId: INBOX_PROJECT.id,
  subTaskIds: [],
  timeSpentOnDay: {},
  timeSpent: 0,
  timeEstimate: 0,
  isDone: false,
  doneOn: undefined,
  title: '',
  notes: '',
  tagIds: [],
  parentId: undefined,
  created: Date.now(),
  repeatCfgId: undefined,
  dueWithTime: undefined,

  attachments: [],

  issueId: undefined,
  issueProviderId: undefined,
  issuePoints: undefined,
  issueType: undefined,
  issueAttachmentNr: undefined,
  issueLastUpdated: undefined,
  issueWasUpdated: undefined,
  issueTimeTracked: undefined,
};
const ALL_TAGS: Tag[] = [
  { ...DEFAULT_TAG, id: 'blu_id', title: 'blu' },
  { ...DEFAULT_TAG, id: 'bla_id', title: 'bla' },
  { ...DEFAULT_TAG, id: 'hihi_id', title: 'hihi' },
  { ...DEFAULT_TAG, id: '1_id', title: '1' },
  { ...DEFAULT_TAG, id: 'A_id', title: 'A' },
  { ...DEFAULT_TAG, id: 'multi_word_id', title: 'Multi Word Tag' },
];
const CONFIG = DEFAULT_GLOBAL_CONFIG.shortSyntax;

// Builds the expected parsedRanges for inputs where each consumed substring
// occurs unambiguously; cases exercising ambiguous inputs (token text also
// present inside a tag/URL/word) assert literal positions instead.
const expectedRanges = (
  title: string,
  tokens: [type: ShortSyntaxTokenType, text: string][],
): ShortSyntaxRange[] => {
  const ranges: ShortSyntaxRange[] = [];
  for (const [type, text] of tokens) {
    let start = title.indexOf(text);
    while (
      start !== -1 &&
      ranges.some((r) => start < r.end && start + text.length > r.start)
    ) {
      start = title.indexOf(text, start + 1);
    }
    if (start === -1) {
      throw new Error(`spec error: '${text}' not found in '${title}'`);
    }
    ranges.push({ type, start, end: start + text.length });
  }
  return ranges.sort((a, b) => a.start - b.start);
};

const getPlannedDateTimestampFromShortSyntaxReturnValue = async (
  taskInput: TaskCopy,
  now: Date = new Date(),
): Promise<number> => {
  const r = await shortSyntax(taskInput, CONFIG, undefined, undefined, now);
  const parsedDateInMilliseconds = r?.taskChanges?.dueWithTime as number;
  return parsedDateInMilliseconds;
};

const checkSameDay = (date1: Date, date2: Date): boolean => {
  expect(date1.getFullYear()).toBe(date2.getFullYear());
  expect(date1.getMonth()).toBe(date2.getMonth());
  expect(date1.getDate()).toBe(date2.getDate());

  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};

const checkIfDateHasCorrectTime = (date: Date, hour: number, minute: number): boolean => {
  expect(date.getHours()).toBe(hour);
  expect(date.getMinutes()).toBe(minute);
  return date.getHours() === hour && date.getMinutes() === minute;
};

const formatDateToISO = (dateObj: Date): string => {
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth() + 1;
  const monthString = month < 10 ? `0${month}` : `${month}`;
  const date = dateObj.getDate();
  const dateString = date < 10 ? `0${date}` : `${date}`;
  return `${year}-${monthString}-${dateString}`;
};

const dayToNumberMap = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const checkIfCorrectDateAndTime = (
  timestamp: number,
  day: string,
  hour: number,
  minute: number,
): boolean => {
  const date = new Date(timestamp);
  const isDayCorrect = date.getDay() === dayToNumberMap[day.toLowerCase()];
  const isHourCorrect = date.getHours() === hour;
  const isMinuteCorrect = date.getMinutes() === minute;
  return isDayCorrect && isHourCorrect && isMinuteCorrect;
};

const checkIfCorrectDateMonthAndYear = (
  timestamp: number,
  givenDate: number,
  givenMonth: number,
  givenYear: number,
  hour?: number,
  minute?: number,
): boolean => {
  const date = new Date(timestamp);
  const correctDateMonthYear =
    date.getDate() === givenDate &&
    date.getMonth() + 1 === givenMonth &&
    date.getFullYear() === givenYear;
  if (!hour) {
    return correctDateMonthYear;
  }
  if (!minute) {
    return correctDateMonthYear && date.getHours() === hour;
  }
  return correctDateMonthYear && date.getHours() === hour && date.getMinutes() === minute;
};

describe('shortSyntax', () => {
  it('should ignore for no short syntax', async () => {
    const r = await shortSyntax(TASK, CONFIG);
    expect(r).toEqual(undefined);
  });

  it('should ignore if the changes cause no further changes', async () => {
    const r = await shortSyntax(
      {
        ...TASK,
        title: 'So what shall I do',
      },
      CONFIG,
    );
    expect(r).toEqual(undefined);
  });

  describe('should work for time short syntax', () => {
    it('', async () => {
      const t = {
        ...TASK,
        title: 'Fun title 10m/1h',
      };
      const r = await shortSyntax(t, CONFIG);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['estimate', '10m/1h']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          // timeSpent: 7200000,
          timeSpentOnDay: {
            [getDbDateStr()]: 600000,
          },
          timeEstimate: 3600000,
        },
      });
    });

    it('', async () => {
      const t = {
        ...TASK,
        title: 'Fun title whatever 1h/120m',
      };
      const r = await shortSyntax(t, CONFIG);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['estimate', '1h/120m']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title whatever',
          // timeSpent: 7200000,
          timeSpentOnDay: {
            [getDbDateStr()]: 3600000,
          },
          timeEstimate: 7200000,
        },
      });
    });

    it('', async () => {
      const t = {
        ...TASK,
        title: 'Fun title whatever 1.5h',
      };
      const r = await shortSyntax(t, CONFIG);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['estimate', '1.5h']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title whatever',
          timeEstimate: 5400000,
        },
      });
    });

    it('', async () => {
      const t = {
        ...TASK,
        title: 'Fun title whatever 1.5h/2.5h',
      };
      const r = await shortSyntax(t, CONFIG);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['estimate', '1.5h/2.5h']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title whatever',
          // timeSpent: 7200000,
          timeSpentOnDay: {
            [getDbDateStr()]: 5400000,
          },
          timeEstimate: 9000000,
        },
      });
    });

    it('should ignore time short syntax when disabled', async () => {
      const t = {
        ...TASK,
        title: 'Fun title whatever 1h/120m',
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableDue: false });
      expect(r).toEqual(undefined);
    });

    it('with time spent only', async () => {
      const t = {
        ...TASK,
        title: 'Task description 30m/',
      };
      const r = await shortSyntax(t, CONFIG);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['estimate', '30m/']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Task description',
          timeSpentOnDay: {
            [getDbDateStr()]: 1800000,
          },
        },
      });
    });
  });

  describe('should recognize short syntax for date', () => {
    it('should correctly parse schedule syntax with time only', async () => {
      const t = {
        ...TASK,
        title: 'Test @4pm',
      };
      // Use fixed date at 10am to avoid race conditions with real system time
      // and ensure we're safely before 4pm for same-day scheduling
      const now = new Date(2024, 0, 15, 10, 0, 0, 0); // Jan 15, 2024 at 10:00 AM
      const parsedDateInMilliseconds =
        await getPlannedDateTimestampFromShortSyntaxReturnValue(t, now);
      const parsedDate = new Date(parsedDateInMilliseconds);
      const isSetToSameDay = checkSameDay(parsedDate, now);
      expect(isSetToSameDay).toBeTrue();
      const isTimeSetCorrectly = checkIfDateHasCorrectTime(parsedDate, 16, 0);
      expect(isTimeSetCorrectly).toBeTrue();
    });

    it('should ignore schedule syntax with time only when disabled', async () => {
      const t = {
        ...TASK,
        title: 'Test @4pm',
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableDue: false });
      expect(r).toEqual(undefined);
    });

    it('should ignore day of the week when disabled', async () => {
      const t = {
        ...TASK,
        title: 'Test @Friday',
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableDue: false });
      expect(r).toEqual(undefined);
    });

    it('should correctly parse day of the week', async () => {
      const t = {
        ...TASK,
        title: 'Test @Friday',
      };
      const now = new Date('Fri Feb 09 2024 11:31:29 ');
      const parsedDateInMilliseconds =
        await getPlannedDateTimestampFromShortSyntaxReturnValue(t, now);
      const parsedDate = new Date(parsedDateInMilliseconds);
      expect(parsedDate.getDay()).toEqual(5);
      const dayIncrement = 0;
      // If today happens to be Friday, the parsed date will be the next Friday,
      // 7 days from today only when after 12
      const nextFriday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + dayIncrement,
      );
      const isDateSetCorrectly = checkSameDay(parsedDate, nextFriday);
      expect(isDateSetCorrectly).toBeTrue();
    });

    it('should properly remove date syntax when there is a space after @', async () => {
      const t = {
        ...TASK,
        title: 'Test @ tomorrow 19:00',
      };
      // set a fixed date to avoid test flakiness
      const now = new Date('2025-12-05T10:00:00');
      const r = await shortSyntax(t, CONFIG, undefined, undefined, now);

      expect(r?.taskChanges.title).toBe('Test');
      expect(r?.taskChanges.dueDay).toBeNull();
    });

    it('should properly remove date syntax when there is a space after @ for simple number', async () => {
      const t = {
        ...TASK,
        title: 'Test @ 4',
      };
      const r = await shortSyntax(t, CONFIG);
      expect(r?.taskChanges.title).toBe('Test');
      expect(r?.taskChanges.dueDay).toBeNull();
    });

    it('should properly remove date syntax with date format like 12/20/25', async () => {
      const t = {
        ...TASK,
        title: 'Test @ 12/20/25 19:00',
      };
      const now = new Date('2025-12-05T10:00:00');
      const r = await shortSyntax(t, CONFIG, undefined, undefined, now);

      expect(r?.taskChanges.title).toBe('Test');
      expect(r?.taskChanges.dueDay).toBeNull();
      expect(r?.taskChanges.dueWithTime).toBeDefined();
      // Verify it's scheduled for the future (Dec 20, 2025 at 19:00)
      const scheduledDate = new Date(r?.taskChanges.dueWithTime as number);
      expect(scheduledDate.getMonth()).toBe(11); // December (0-indexed)
      expect(scheduledDate.getDate()).toBe(20);
      expect(scheduledDate.getHours()).toBe(19);
    });

    it('should schedule overdue task to future when using inline @ syntax', async () => {
      const t = {
        ...TASK,
        title: 'Overdue task @tomorrow 14:00',
        dueDay: '2025-12-01', // Simulating an overdue task
      };
      const now = new Date('2025-12-05T10:00:00');
      const r = await shortSyntax(t, CONFIG, undefined, undefined, now);

      expect(r?.taskChanges.title).toBe('Overdue task');
      expect(r?.taskChanges.dueDay).toBeNull(); // Should clear the old dueDay
      expect(r?.taskChanges.dueWithTime).toBeDefined();
      // Verify it's scheduled for tomorrow (Dec 6, 2025 at 14:00)
      const scheduledDate = new Date(r?.taskChanges.dueWithTime as number);
      expect(scheduledDate.getFullYear()).toBe(2025);
      expect(scheduledDate.getMonth()).toBe(11); // December
      expect(scheduledDate.getDate()).toBe(6); // Tomorrow
      expect(scheduledDate.getHours()).toBe(14);
    });

    it('should correctly parse combined schedule and deadline together without corrupting title', async () => {
      const t = {
        ...TASK,
        title: 'Pay rent @monday !friday',
      };
      const now = new Date('2026-06-01T10:00:00'); // Mon Jun 1 2026
      const r = await shortSyntax(t, CONFIG, undefined, undefined, now);

      expect(r?.taskChanges.title).toBe('Pay rent');
      expect(r?.taskChanges.dueWithTime).toBeDefined();
      expect(r?.taskChanges.deadlineWithTime).toBeDefined();

      const dueDate = new Date(r?.taskChanges.dueWithTime as number);
      const deadlineDate = new Date(r?.taskChanges.deadlineWithTime as number);

      expect(dueDate.getDay()).toBe(1); // Monday
      expect(deadlineDate.getDay()).toBe(5); // Friday
    });

    it('should still parse schedule syntax when there is no preceding space (e.g. lunch@12)', async () => {
      const t = {
        ...TASK,
        title: 'lunch@12',
      };
      const now = new Date('2026-06-01T10:00:00');
      const r = await shortSyntax(t, CONFIG, undefined, undefined, now);

      expect(r?.taskChanges.title).toBe('lunch');
      expect(r?.taskChanges.dueWithTime).toBeDefined();
    });

    it('should not parse deadline syntax when there is no preceding space (e.g. Done!)', async () => {
      const t = {
        ...TASK,
        title: 'Done!',
      };
      const now = new Date('2026-06-01T10:00:00');
      const r = await shortSyntax(t, CONFIG, undefined, undefined, now);

      expect(r).toBeUndefined();
    });
  });

  describe('tags', () => {
    it('should not trigger for tasks with starting # (e.g. github issues)', async () => {
      const t = {
        ...TASK,
        title: '#134 Fun title',
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should not trigger for tasks with starting # (e.g. github issues) when disabled', async () => {
      const t = {
        ...TASK,
        title: '#134 Fun title',
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should not parse numeric tag when it is the first word in the title', async () => {
      const t = {
        ...TASK,
        title: '#123 Task description',
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should not parse issue references (e.g. "fixes #1234") as tags for issue tasks', async () => {
      const t = {
        ...TASK,
        issueId: '42',
        title: '#42 Fix regression from #1234',
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should still parse non-numeric existing #tags in issue task titles', async () => {
      const t = {
        ...TASK,
        issueId: '42',
        title: '#42 Some title #blu',
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['tag', '#blu']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: '#42 Some title',
          tagIds: ['blu_id'],
        },
      });
    });

    it('should not trigger for tasks with starting # (e.g. github issues) when adding tags', async () => {
      const t = {
        ...TASK,
        title: '#134 Fun title #blu',
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['tag', '#blu']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: '#134 Fun title',
          tagIds: ['blu_id'],
        },
      });
    });

    it('should not trigger for multiple tasks when disabled', async () => {
      const t = {
        ...TASK,
        title: '#134 Fun title #blu',
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should add tag when it is the first word in the title', async () => {
      const t = {
        ...TASK,
        title: '#blu Fun title',
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['tag', '#blu']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          tagIds: ['blu_id'],
        },
      });
    });

    it('should add multiple tags even if the first tag is at the beginning', async () => {
      const t = {
        ...TASK,
        title: '#blu #hihi Fun title',
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [
          ['tag', '#blu'],
          ['tag', '#hihi'],
        ]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          tagIds: ['blu_id', 'hihi_id'],
        },
      });
    });

    it('should work with tags', async () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #A',
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [
          ['tag', '#blu'],
          ['tag', '#A'],
        ]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          tagIds: ['blu_id', 'A_id'],
        },
      });
    });

    it("shouldn't work with tags when disabled", async () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #A',
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should not trigger for # without space before', async () => {
      const t = {
        ...TASK,
        title: 'Fun title#blu',
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should not trigger for # without space before but parse other tags', async () => {
      const t = {
        ...TASK,
        title: 'Fun title#blu #bla',
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['tag', '#bla']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title#blu',
          tagIds: ['bla_id'],
        },
      });
    });

    it('should not overwrite existing tags', async () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #hihi',
        tagIds: ['blu_id', 'A', 'multi_word_id'],
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [
          ['tag', '#blu'],
          ['tag', '#hihi'],
        ]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          tagIds: ['blu_id', 'A', 'multi_word_id', 'hihi_id'],
        },
      });
    });

    it('should not overwrite existing tags when disabled', async () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #hihi',
        tagIds: ['blu_id', 'A', 'multi_word_id'],
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should add new tag names', async () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #idontexist',
        tagIds: [],
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: ['idontexist'],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [
          ['tag', '#blu'],
          ['tag', '#idontexist'],
        ]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          tagIds: ['blu_id'],
        },
      });
    });

    it('should not add new tag names when disabled', async () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #idontexist',
        tagIds: [],
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should remove tags not existing on title', async () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #bla',
        tagIds: ['blu_id', 'bla_id', 'hihi_id'],
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS, undefined, undefined, 'replace');

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [
          ['tag', '#blu'],
          ['tag', '#bla'],
        ]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          tagIds: ['blu_id', 'bla_id'],
        },
      });
    });

    it('should not remove tags not existing on title when disabled', async () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #bla',
        tagIds: ['blu_id', 'bla_id', 'hihi_id'],
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should add new "asd #asd" tag', async () => {
      const t = {
        ...TASK,
        title: 'asd #asd',
        tagIds: [],
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: ['asd'],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['tag', '#asd']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'asd',
        },
      });
    });

    it('should work for edge case #3728', async () => {
      const t = {
        ...TASK,
        title: 'Test tag error #testing #someNewTag3',
        tagIds: [],
      };
      const r = await shortSyntax(t, CONFIG, [
        ...ALL_TAGS,
        { ...DEFAULT_TAG, id: 'testing_id', title: 'testing' },
      ]);

      expect(r).toEqual({
        newTagTitles: ['someNewTag3'],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [
          ['tag', '#testing'],
          ['tag', '#someNewTag3'],
        ]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Test tag error',
          tagIds: ['testing_id'],
        },
      });
    });

    it('should not add new "asd #asd" tag when disabled', async () => {
      const t = {
        ...TASK,
        title: 'asd #asd',
        tagIds: [],
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should add tags for sub tasks', async () => {
      const t = {
        ...TASK,
        parentId: 'SOMEPARENT',
        title: 'Fun title #blu #idontexist',
        tagIds: [],
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: ['idontexist'],
        projectId: undefined,
        attachments: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [
          ['tag', '#blu'],
          ['tag', '#idontexist'],
        ]),
        taskChanges: { tagIds: ['blu_id'], title: 'Fun title' },
      });
    });

    it('should not add tags for sub tasks when disabled', async () => {
      const t = {
        ...TASK,
        parentId: 'SOMEPARENT',
        title: 'Fun title #blu #idontexist',
        tagIds: [],
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should remove tag from title if task already has tag', async () => {
      const t = {
        ...TASK,
        title: 'Test tag #testing',
        tagIds: ['testing_id'],
      };
      const r = await shortSyntax(t, CONFIG, [
        ...ALL_TAGS,
        { ...DEFAULT_TAG, id: 'testing_id', title: 'testing' },
      ]);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['tag', '#testing']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Test tag',
        },
      });
    });

    it('should create new tag and remove both from title if task already has one given tag', async () => {
      const t = {
        ...TASK,
        title: 'Test tag #testing #blu',
        tagIds: ['blu_id'],
      };
      const r = await shortSyntax(t, CONFIG, [
        ...ALL_TAGS,
        { ...DEFAULT_TAG, id: 'blu_id', title: 'blu' },
      ]);

      expect(r).toEqual({
        newTagTitles: ['testing'],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [
          ['tag', '#testing'],
          ['tag', '#blu'],
        ]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Test tag',
        },
      });
    });

    it('should add existing tag and remove both from title if task already has one given tag', async () => {
      const t = {
        ...TASK,
        title: 'Test tag #testing #blu',
        tagIds: ['blu_id'],
      };
      const r = await shortSyntax(t, CONFIG, [
        ...ALL_TAGS,
        { ...DEFAULT_TAG, id: 'blu_id', title: 'blu' },
        { ...DEFAULT_TAG, id: 'testing_id', title: 'testing' },
      ]);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [
          ['tag', '#testing'],
          ['tag', '#blu'],
        ]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Test tag',
          tagIds: ['blu_id', 'testing_id'],
        },
      });
    });

    it('should not remove tag from title if task already has tag when disabled', async () => {
      const t = {
        ...TASK,
        title: 'Test tag #testing',
        tagIds: ['testing_id'],
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });
  });
  describe('should work with tags and time estimates combined', () => {
    it('tag before time estimate', async () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu 10m/1h',
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [
          ['estimate', '10m/1h'],
          ['tag', '#blu'],
        ]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          // timeSpent: 7200000,
          timeSpentOnDay: {
            [getDbDateStr()]: 600000,
          },
          timeEstimate: 3600000,
          tagIds: ['blu_id'],
        },
      });
    });

    it('time estimate before tag', async () => {
      const t = {
        ...TASK,
        title: 'Fun title 10m/1h #blu',
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [
          ['estimate', '10m/1h'],
          ['tag', '#blu'],
        ]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          timeSpentOnDay: {
            [getDbDateStr()]: 600000,
          },
          timeEstimate: 3600000,
          tagIds: ['blu_id'],
        },
      });
    });

    it('time estimate disabled', async () => {
      const t = {
        ...TASK,
        title: 'Fun title 10m/1h #blu',
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableDue: false }, ALL_TAGS);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['tag', '#blu']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title 10m/1h',
          tagIds: ['blu_id'],
        },
      });
    });

    it('tags disabled', async () => {
      const t = {
        ...TASK,
        title: 'Fun title 10m/1h #blu',
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['estimate', '10m/1h']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title #blu',
          timeSpentOnDay: {
            [getDbDateStr()]: 600000,
          },
          timeEstimate: 3600000,
        },
      });
    });
  });

  describe('projects', () => {
    let projects: Project[];
    beforeEach(() => {
      projects = [
        {
          title: 'ProjectEasyShort',
          id: 'ProjectEasyShortID',
        },
        {
          title: 'Some Project Title',
          id: 'SomeProjectID',
        },
      ] as any;
    });

    it('should work', async () => {
      const t = {
        ...TASK,
        title: 'Fun title +ProjectEasyShort',
      };
      const r = await shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['project', '+ProjectEasyShort']]),
        projectId: 'ProjectEasyShortID',
        attachments: [],
        taskChanges: {
          title: 'Fun title',
        },
      });
    });

    it("shouldn't work when disabled", async () => {
      const t = {
        ...TASK,
        title: 'Fun title +ProjectEasyShort',
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableProject: false }, [], projects);
      expect(r).toEqual(undefined);
    });

    it('should not parse without missing whitespace before', async () => {
      const t = {
        ...TASK,
        title: 'Fun title+ProjectEasyShort',
      };
      const r = await shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual(undefined);
    });

    it('should work together with time estimates', async () => {
      const t = {
        ...TASK,
        title: 'Fun title +ProjectEasyShort 10m/1h',
      };
      const r = await shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [
          ['estimate', '10m/1h'],
          ['project', '+ProjectEasyShort'],
        ]),
        projectId: 'ProjectEasyShortID',
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          // timeSpent: 7200000,
          timeSpentOnDay: {
            [getDbDateStr()]: 600000,
          },
          timeEstimate: 3600000,
        },
      });
    });

    it('should work together with time estimates when disabled', async () => {
      const t = {
        ...TASK,
        title: 'Fun title +ProjectEasyShort 10m/1h',
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableProject: false }, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['estimate', '10m/1h']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title +ProjectEasyShort',
          // timeSpent: 7200000,
          timeSpentOnDay: {
            [getDbDateStr()]: 600000,
          },
          timeEstimate: 3600000,
        },
      });
    });

    it('should work together with disabled time estimates', async () => {
      const t = {
        ...TASK,
        title: 'Fun title +ProjectEasyShort 10m/1h',
      };
      const r = await shortSyntax(t, { ...CONFIG, isEnableDue: false }, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['project', '+ProjectEasyShort']]),
        projectId: 'ProjectEasyShortID',
        attachments: [],
        taskChanges: {
          title: 'Fun title 10m/1h',
        },
      });
    });

    it('should work with only the beginning of a project title if it is at least 3 chars long', async () => {
      const t = {
        ...TASK,
        title: 'Fun title +Project',
      };
      const r = await shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['project', '+Project']]),
        projectId: 'ProjectEasyShortID',
        attachments: [],
        taskChanges: {
          title: 'Fun title',
        },
      });
    });

    it('should work with multi word project titles', async () => {
      const t = {
        ...TASK,
        title: 'Fun title +Some Project Title',
      };
      const r = await shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['project', '+Some Project Title']]),
        projectId: 'SomeProjectID',
        attachments: [],
        taskChanges: {
          title: 'Fun title',
        },
      });
    });

    it('should work with multi word project titles partial', async () => {
      const t = {
        ...TASK,
        title: 'Fun title +Some Pro',
      };
      const r = await shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['project', '+Some Pro']]),
        projectId: 'SomeProjectID',
        attachments: [],
        taskChanges: {
          title: 'Fun title',
        },
      });
    });

    it('should work with multi word project titles partial written without white space', async () => {
      const t = {
        ...TASK,
        title: 'Other fun title +SomePro',
      };
      const r = await shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['project', '+SomePro']]),
        projectId: 'SomeProjectID',
        attachments: [],
        taskChanges: {
          title: 'Other fun title',
        },
      });
    });

    it('should ignore non existing', async () => {
      const t = {
        ...TASK,
        title: 'Other fun title +Non existing project',
      };
      const r = await shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual(undefined);
    });

    it('should not parse when there is a space after +', async () => {
      const t = {
        ...TASK,
        title: 'Fun title + ProjectEasyShort',
      };
      const r = await shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual(undefined);
    });

    it('should not parse when there is a space after + with other syntax', async () => {
      const t = {
        ...TASK,
        title: 'Fun title + ProjectEasyShort 10m',
      };
      const r = await shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['estimate', '10m']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title + ProjectEasyShort',
          timeEstimate: 600000,
        },
      });
    });

    it('should not parse when + is followed by multiple spaces', async () => {
      const t = {
        ...TASK,
        title: 'Fun title +  ProjectEasyShort',
      };
      const r = await shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual(undefined);
    });

    it('should prefer shortest prefix full project title match', async () => {
      const t = {
        ...TASK,
        title: 'Task +print',
      };
      projects = ['printer', 'imprints', 'print', 'printable'].map(
        (title) => ({ id: title, title }) as Project,
      );
      const r = await shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['project', '+print']]),
        projectId: 'print',
        attachments: [],
        taskChanges: {
          title: 'Task',
        },
      });
    });
  });

  describe('combined', () => {
    it('should work when time comes first', async () => {
      const projects = [
        {
          title: 'ProjectEasyShort',
          id: 'ProjectEasyShortID',
        },
      ] as any;
      const t = {
        ...TASK,
        title: 'Fun title 10m/1h +ProjectEasyShort',
      };
      const r = await shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [
          ['estimate', '10m/1h'],
          ['project', '+ProjectEasyShort'],
        ]),
        projectId: 'ProjectEasyShortID',
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          // timeSpent: 7200000,
          timeSpentOnDay: {
            [getDbDateStr()]: 600000,
          },
          timeEstimate: 3600000,
        },
      });
    });

    it('should work for project first', async () => {
      const projects = [
        {
          title: 'ProjectEasyShort',
          id: 'ProjectEasyShortID',
        },
      ] as any;
      const t = {
        ...TASK,
        title: 'Some task +ProjectEasyShort 30m #tag',
      };
      const r = await shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: ['tag'],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [
          ['project', '+ProjectEasyShort'],
          ['estimate', '30m'],
          ['tag', '#tag'],
        ]),
        projectId: 'ProjectEasyShortID',
        attachments: [],
        taskChanges: {
          title: 'Some task',
          // timeSpent: 7200000,
          timeEstimate: 1800000,
        },
      });
    });
    it('should correctly parse scheduled date, project, time spent and estimate', async () => {
      const projects = [
        {
          title: 'Project',
          id: 'a1b2',
        },
        {
          title: 'Another Project',
          id: 'c3d4',
        },
      ] as any;
      const taskInput = `Test @Friday 4pm +${projects[0].title} 2h/4h`;
      const t = {
        ...TASK,
        title: taskInput,
      };
      const parsedDateInMilliseconds =
        await getPlannedDateTimestampFromShortSyntaxReturnValue(t);
      const parsedDate = new Date(parsedDateInMilliseconds);
      // The parsed day and time should be Friday, or 5, and time is 16 hours and 0 minute
      expect(parsedDate.getDay()).toEqual(5);
      const isTimeSetCorrectly = checkIfDateHasCorrectTime(parsedDate, 16, 0);
      expect(isTimeSetCorrectly).toBeTrue();
      const parsedTaskInfo = await shortSyntax(t, CONFIG, [], projects);
      expect(parsedTaskInfo?.projectId).toEqual(projects[0].id);
      // The time spent value is stored to the property equal to today
      // in format YYYY-MM-DD of the object `timeSpentOnDay`
      const today = new Date();
      const formatedToday = formatDateToISO(today);
      // Time estimate and time spent should be correctly parsed in milliseconds
      expect(parsedTaskInfo?.taskChanges.timeEstimate).toEqual(3600 * 4 * 1000);
      expect(parsedTaskInfo?.taskChanges?.timeSpentOnDay?.[formatedToday]).toEqual(
        3600 * 2 * 1000,
      );
    });
    it('should correctly parse scheduled date and multiple tags', async () => {
      const t = {
        ...TASK,
        title: 'Test @fri 4pm #html #css',
      };
      const plannedTimestamp = await getPlannedDateTimestampFromShortSyntaxReturnValue(t);
      const isPlannedDateAndTimeCorrect = checkIfCorrectDateAndTime(
        plannedTimestamp,
        'friday',
        16,
        0,
      );
      expect(isPlannedDateAndTimeCorrect).toBeTrue();
      const parsedTaskInfo = await shortSyntax(t, CONFIG, []);
      expect(parsedTaskInfo?.newTagTitles.includes('html')).toBeTrue();
      expect(parsedTaskInfo?.newTagTitles.includes('css')).toBeTrue();
    });

    it('should parse scheduled date using local time zone when unspecified', async () => {
      const t = {
        ...TASK,
        title: '@2030-10-12T13:37',
      };
      const plannedTimestamp = await getPlannedDateTimestampFromShortSyntaxReturnValue(t);
      expect(checkIfCorrectDateAndTime(plannedTimestamp, 'saturday', 13, 37)).toBeTrue();
    });

    it('should work when all are disabled', async () => {
      const t = {
        ...TASK,
        title: 'Test @fri 4pm #html #css +ProjectEasyShort',
      };
      const r = await shortSyntax(t, {
        isEnableDue: false,
        isEnableProject: false,
        isEnableTag: false,
        urlBehavior: 'keep-and-attach',
      });
      expect(r).toEqual(undefined);
    });
  });

  describe('projects using special delimiters', () => {
    const taskTemplates = [
      'Task *',
      'Task * 10m',
      'Task * 1h / 2h',
      'Task * @tomorrow',
      'Task * @in 1 day',
      'Task * #A',
    ];

    const projects = ['a+b', '10 contracts', 'c++', 'my@email.com', 'issue#123'].map(
      (title) => ({ id: title, title }) as Project,
    );

    for (const taskTemplate of taskTemplates) {
      for (const project of projects) {
        const taskTitle = taskTemplate.replaceAll('*', `+${project.title}`);
        it(`should parse project "${project.title}" from "${taskTitle}"`, async () => {
          const task = {
            ...TASK,
            title: taskTitle,
          };
          const result = await shortSyntax(task, CONFIG, ALL_TAGS, projects);
          expect(result?.projectId).toBe(project.id);
        });
      }
    }
  });

  // This group of tests address Chrono's parsing the format "<date> <month> <yy}>" as year
  // This will cause unintended parsing result when the date syntax is used together with the time estimate syntax
  // https://github.com/super-productivity/super-productivity/issues/4194
  // The focus of this test group will be the ability of the parser to get the correct year and time estimate
  describe('should not parse time estimate syntax as year', () => {
    const today = new Date();
    const minuteEstimate = 90;

    it('should correctly parse year and time estimate when the input date only has month and day of the month', async () => {
      const tomorrow = new Date(today.getTime() + oneDayInMilliseconds);
      const inputMonth = tomorrow.getMonth() + 1;
      const inputMonthName = MONTH_SHORT_NAMES[tomorrow.getMonth()];
      const inputDayOfTheMonth = tomorrow.getDate();
      const t = {
        ...TASK,
        title: `Test @${inputMonthName} ${inputDayOfTheMonth} ${minuteEstimate}m`,
      };
      const parsedTaskInfo = await shortSyntax(t, CONFIG, []);
      const taskChanges = parsedTaskInfo?.taskChanges;
      const dueWithTime = taskChanges?.dueWithTime as number;
      expect(
        checkIfCorrectDateMonthAndYear(
          dueWithTime,
          inputDayOfTheMonth,
          inputMonth,
          tomorrow.getFullYear(),
        ),
      ).toBeTrue();
      expect(taskChanges?.timeEstimate).toEqual(minuteEstimate * 60 * 1000);
    });

    it('should correctly parse year and time estimate when the input date contains month, day of the month and time', async () => {
      const time = '4pm';
      const tomorrow = new Date(today.getTime() + oneDayInMilliseconds);
      const inputMonth = tomorrow.getMonth() + 1;
      const inputMonthName = MONTH_SHORT_NAMES[tomorrow.getMonth()];
      const inputDayOfTheMonth = tomorrow.getDate();
      const t = {
        ...TASK,
        title: `Test @${inputMonthName} ${inputDayOfTheMonth} ${time} ${minuteEstimate}m`,
      };
      const parsedTaskInfo = await shortSyntax(t, CONFIG, []);
      const taskChanges = parsedTaskInfo?.taskChanges;
      const dueWithTime = taskChanges?.dueWithTime as number;
      expect(
        checkIfCorrectDateMonthAndYear(
          dueWithTime,
          inputDayOfTheMonth,
          inputMonth,
          tomorrow.getFullYear(),
          16,
        ),
      ).toBeTrue();
      expect(taskChanges?.timeEstimate).toEqual(minuteEstimate * 60 * 1000);
    });
  });

  describe('time unit clusters', () => {
    const testCases: [string, number | undefined, number | undefined][] = [
      ['1h 30m', 90, undefined],
      ['2h5m', 125, undefined],
      ['1h 30m /', undefined, 90],
      ['2h5m/', undefined, 125],
      ['1h 30m / 12h', 720, 90],
      ['1.25h / 1h 4m', 64, 75],
      ['2h5m/3h', 180, 125],
    ];

    for (const [title, timeEstimateMins, timeSpentMins] of testCases) {
      const timeEstimate =
        typeof timeEstimateMins === 'number' ? timeEstimateMins * 60 * 1000 : undefined;
      const timeSpentOnDay =
        typeof timeSpentMins === 'number' ? timeSpentMins * 60 * 1000 : undefined;
      it(`should parse ${
        timeEstimate === undefined
          ? 'no time estimate'
          : 'time estimate of ' + timeEstimate
      } and ${
        timeSpentOnDay === undefined
          ? 'no time spent on day'
          : 'time spent on day of ' + timeSpentOnDay
      } from "${title}"`, async () => {
        const task = {
          ...TASK,
          title,
        };
        const result = await shortSyntax(task, CONFIG, [], []);
        expect(result?.taskChanges.timeEstimate).toBe(timeEstimate);
        expect(result?.taskChanges.timeSpentOnDay?.[getDbDateStr()]).toBe(timeSpentOnDay);
      });
    }
  });

  describe('case sensitivity (#6515)', () => {
    it('should not parse uppercase 3D in task title', async () => {
      const t = { ...TASK, title: 'create 3D floor plan' };
      const r = await shortSyntax(t, CONFIG);
      expect(r).toEqual(undefined);
    });

    it('should not parse mixed case 3D in task title', async () => {
      const t = { ...TASK, title: 'create 3d floor plan' };
      const r = await shortSyntax(t, CONFIG);
      expect(r).toEqual(undefined);
    });

    it('should not parse uppercase 3M in task title', async () => {
      const t = { ...TASK, title: 'compare 3M products' };
      const r = await shortSyntax(t, CONFIG);
      expect(r).toEqual(undefined);
    });

    it('should not parse uppercase 3H in task title', async () => {
      const t = { ...TASK, title: 'task 3H' };
      const r = await shortSyntax(t, CONFIG);
      expect(r).toEqual(undefined);
    });

    it('should still parse lowercase 3m as time estimate', async () => {
      const t = { ...TASK, title: 'task 3m' };
      const r = await shortSyntax(t, CONFIG);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['estimate', '3m']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'task',
          timeEstimate: 180000,
        },
      });
    });

    it('should still parse lowercase 3h as time estimate', async () => {
      const t = { ...TASK, title: 'task 3h' };
      const r = await shortSyntax(t, CONFIG);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        repeatQuickSetting: null,
        parsedRanges: expectedRanges(t.title, [['estimate', '3h']]),
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'task',
          timeEstimate: 10800000,
        },
      });
    });
  });

  describe('URL attachments', () => {
    const EXTRACT_CONFIG = { ...CONFIG, urlBehavior: 'extract' as const };

    it('should extract single URL with https protocol', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('https://example.com');
      expect(r?.attachments[0].type).toBe('LINK');
      expect(r?.attachments[0].icon).toBe('bookmark');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should extract single URL with http protocol', async () => {
      const t = {
        ...TASK,
        title: 'Task http://example.com',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('http://example.com');
      expect(r?.attachments[0].type).toBe('LINK');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should extract single URL with file:// protocol', async () => {
      const t = {
        ...TASK,
        title: 'Task file:///path/to/document.pdf',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('file:///path/to/document.pdf');
      expect(r?.attachments[0].type).toBe('FILE');
      expect(r?.attachments[0].icon).toBe('insert_drive_file');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should extract single URL with www prefix', async () => {
      const t = {
        ...TASK,
        title: 'Task www.example.com',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('//www.example.com');
      expect(r?.attachments[0].type).toBe('LINK');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should handle multiple URLs with mixed protocols', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com www.test.org file:///home/doc.txt',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(3);
      expect(r?.attachments[0].path).toBe('https://example.com');
      expect(r?.attachments[0].type).toBe('LINK');
      expect(r?.attachments[1].path).toBe('//www.test.org');
      expect(r?.attachments[1].type).toBe('LINK');
      expect(r?.attachments[2].path).toBe('file:///home/doc.txt');
      expect(r?.attachments[2].type).toBe('FILE');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should detect image URLs as IMG type for https', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com/image.png',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].type).toBe('IMG');
      expect(r?.attachments[0].icon).toBe('image');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should detect image URLs as IMG type for file://', async () => {
      const t = {
        ...TASK,
        title: 'Task file:///path/to/image.jpg',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].type).toBe('IMG');
      expect(r?.attachments[0].icon).toBe('image');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should work correctly with combined short syntax', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com @tomorrow #urgent 30m',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG, ALL_TAGS);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('https://example.com');
      expect(r?.taskChanges.title).toBe('Task');
      expect(r?.taskChanges.timeEstimate).toBe(1800000);
      expect(r?.newTagTitles).toContain('urgent');
      expect(r?.taskChanges.dueWithTime).toBeDefined();
    });

    it('should clean URLs from title properly', async () => {
      const t = {
        ...TASK,
        title: 'Task with https://example.com in middle',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG);
      expect(r).toBeDefined();
      expect(r?.taskChanges.title).toBe('Task with in middle');
      expect(r?.attachments.length).toBe(1);
    });

    it('should handle Windows file paths', async () => {
      const t = {
        ...TASK,
        title: 'Task file:///C:/Users/name/document.pdf',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('file:///C:/Users/name/document.pdf');
      expect(r?.attachments[0].type).toBe('FILE');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should handle Unix file paths', async () => {
      const t = {
        ...TASK,
        title: 'Task file:///home/user/document.txt',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('file:///home/user/document.txt');
      expect(r?.attachments[0].type).toBe('FILE');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should not parse URLs for issue tasks', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com',
        issueId: 'ISSUE-123',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG);
      expect(r).toBeUndefined();
    });

    it('should handle URLs with trailing punctuation', async () => {
      const t = {
        ...TASK,
        title: 'Check https://example.com.',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('https://example.com');
      expect(r?.taskChanges.title).toBe('Check .');
    });

    it('should extract basename as attachment title', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com/path/to/file.pdf',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].title).toBe('file');
    });

    it('should extract basename correctly for URLs with trailing slash', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com/projects/',
      };
      const r = await shortSyntax(t, EXTRACT_CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('https://example.com/projects/');
      expect(r?.attachments[0].title).toBe('projects');
      expect(r?.taskChanges.title).toBe('Task');
    });
  });

  describe('URL behavior modes', () => {
    it('should remove URL from title when urlBehavior is "extract"', async () => {
      const t = {
        ...TASK,
        title: 'Check https://example.com for details',
      };
      const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'extract' });
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('https://example.com');
      expect(r?.taskChanges.title).toBe('Check for details');
    });

    it('should use attachment title as task name when pasting a bare URL with urlBehavior "extract"', async () => {
      const t = {
        ...TASK,
        title: 'https://example.com/my-cool-page',
      };
      const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'extract' });
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('https://example.com/my-cool-page');
      expect(r?.taskChanges.title).toBe('my-cool-page');
    });

    it('should use domain basename as task name when pasting a root URL with urlBehavior "extract"', async () => {
      const t = {
        ...TASK,
        title: 'https://example.com',
      };
      const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'extract' });
      expect(r).toBeDefined();
      expect(r?.taskChanges.title).toBe('example');
    });

    it('should keep URL in title and add attachment when urlBehavior is "keep-and-attach"', async () => {
      const t = {
        ...TASK,
        title: 'Check https://example.com for details',
      };
      const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'keep-and-attach' });
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('https://example.com');
      expect(r?.taskChanges.title).toBe('Check https://example.com for details');
    });

    it('should keep URL in title without attachment when urlBehavior is "keep"', async () => {
      const t = {
        ...TASK,
        title: 'Check https://example.com for details',
      };
      const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'keep' });
      expect(r).toBeUndefined();
    });

    it('should keep multiple URLs in title and add attachments when urlBehavior is "keep-and-attach"', async () => {
      const t = {
        ...TASK,
        title: 'Check https://example.com and www.test.org',
      };
      const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'keep-and-attach' });
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(2);
      expect(r?.attachments[0].path).toBe('https://example.com');
      expect(r?.attachments[1].path).toBe('//www.test.org');
      expect(r?.taskChanges.title).toBe('Check https://example.com and www.test.org');
    });

    it('should remove multiple URLs from title when urlBehavior is "extract"', async () => {
      const t = {
        ...TASK,
        title: 'Check https://example.com and www.test.org',
      };
      const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'extract' });
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(2);
      expect(r?.taskChanges.title).toBe('Check and');
    });

    it('should work with keep-and-attach mode and other short syntax', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com @tomorrow #urgent 30m',
      };
      const r = await shortSyntax(
        t,
        { ...CONFIG, urlBehavior: 'keep-and-attach' },
        ALL_TAGS,
      );
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('https://example.com');
      expect(r?.taskChanges.title).toBe('Task https://example.com');
      expect(r?.taskChanges.timeEstimate).toBe(1800000);
      expect(r?.newTagTitles).toContain('urgent');
      expect(r?.taskChanges.dueWithTime).toBeDefined();
    });

    it('should work with keep mode and other short syntax', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com @tomorrow #urgent 30m',
      };
      const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'keep' }, ALL_TAGS);
      expect(r).toBeDefined();
      // In 'keep' mode, URL is not added as attachment, so attachments should be empty or undefined
      expect(r?.attachments?.length || 0).toBe(0);
      expect(r?.taskChanges.title).toBe('Task https://example.com');
      expect(r?.taskChanges.timeEstimate).toBe(1800000);
      expect(r?.newTagTitles).toContain('urgent');
      expect(r?.taskChanges.dueWithTime).toBeDefined();
    });

    it('should create attachments in extract and keep-and-attach modes', async () => {
      const t1 = {
        ...TASK,
        title: 'Task https://example.com',
      };
      const t2 = {
        ...TASK,
        title: 'Task https://example.com',
      };

      const extractResult = await shortSyntax(t1, { ...CONFIG, urlBehavior: 'extract' });
      const keepAndAttachResult = await shortSyntax(t2, {
        ...CONFIG,
        urlBehavior: 'keep-and-attach',
      });

      expect(extractResult?.attachments.length).toBe(1);
      expect(keepAndAttachResult?.attachments.length).toBe(1);
      expect(extractResult?.attachments[0].path).toBe(
        keepAndAttachResult?.attachments[0].path,
      );
      expect(extractResult?.attachments[0].type).toBe(
        keepAndAttachResult?.attachments[0].type,
      );
    });

    it('should use default urlBehavior "keep" from CONFIG', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com',
      };
      // CONFIG has urlBehavior: 'keep' as default (from updated default config)
      const r = await shortSyntax(t, CONFIG);
      // In 'keep' mode, URL stays in title but no attachment is created, so no changes
      expect(r).toBeUndefined();
    });

    it('should use default urlBehavior "keep" when undefined', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com',
      };
      const r = await shortSyntax(t, { ...CONFIG, urlBehavior: undefined });
      // When urlBehavior is undefined, defaults to 'keep' mode
      expect(r).toBeUndefined();
    });

    it('should not create duplicate attachments in keep-and-attach mode', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com',
        attachments: [
          {
            id: 'existing-1',
            type: 'LINK' as const,
            path: 'https://example.com',
            title: 'example',
            icon: 'bookmark',
          },
        ],
      };
      const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'keep-and-attach' });
      // Should return undefined because URL already exists as attachment and title unchanged
      expect(r).toBeUndefined();
    });

    it('should not create duplicate attachments in extract mode', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com',
        attachments: [
          {
            id: 'existing-1',
            type: 'LINK' as const,
            path: 'https://example.com',
            title: 'example',
            icon: 'bookmark',
          },
        ],
      };
      const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'extract' });
      // Should still remove URL from title but not create duplicate attachment
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(0);
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should create attachment for new URL even with existing attachments in keep-and-attach mode', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com https://newsite.com',
        attachments: [
          {
            id: 'existing-1',
            type: 'LINK' as const,
            path: 'https://example.com',
            title: 'example',
            icon: 'bookmark',
          },
        ],
      };
      const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'keep-and-attach' });
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('https://newsite.com');
      expect(r?.taskChanges.title).toBe('Task https://example.com https://newsite.com');
    });

    it('should not create any attachments in keep mode even with URLs', async () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com https://newsite.com',
      };
      const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'keep' });
      expect(r).toBeUndefined();
    });

    describe('markdown links (issue #7032)', () => {
      it('should not extract URL from markdown link in keep mode', async () => {
        const t = {
          ...TASK,
          title: 'Add [Website](https://example.com/)',
        };
        const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'keep' });
        expect(r).toBeUndefined();
      });

      it('should extract correct URL from markdown link in extract mode', async () => {
        const t = {
          ...TASK,
          title: 'Add [Website](https://example.com/)',
        };
        const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'extract' });
        expect(r).toBeDefined();
        expect(r?.attachments.length).toBe(1);
        expect(r?.attachments[0].path).toBe('https://example.com/');
        expect(r?.taskChanges.title).toBe('Add Website');
      });

      it('should extract correct URL from markdown link in keep-and-attach mode', async () => {
        const t = {
          ...TASK,
          title: 'Add [Website](https://example.com/)',
        };
        const r = await shortSyntax(t, {
          ...CONFIG,
          urlBehavior: 'keep-and-attach',
        });
        expect(r).toBeDefined();
        expect(r?.attachments.length).toBe(1);
        expect(r?.attachments[0].path).toBe('https://example.com/');
        // keep-and-attach preserves the original title
        expect(r?.taskChanges.title).toBe('Add [Website](https://example.com/)');
      });

      it('should handle markdown link with trailing text', async () => {
        const t = {
          ...TASK,
          title: 'Check [docs](https://example.com/docs) for details',
        };
        const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'extract' });
        expect(r).toBeDefined();
        expect(r?.attachments.length).toBe(1);
        expect(r?.attachments[0].path).toBe('https://example.com/docs');
        expect(r?.taskChanges.title).toBe('Check docs for details');
      });

      it('should handle markdown link with parentheses in URL', async () => {
        const t = {
          ...TASK,
          title: 'Read [article](https://en.wikipedia.org/wiki/C_(programming_language))',
        };
        const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'extract' });
        expect(r).toBeDefined();
        expect(r?.attachments.length).toBe(1);
        expect(r?.attachments[0].path).toBe(
          'https://en.wikipedia.org/wiki/C_(programming_language)',
        );
        expect(r?.taskChanges.title).toBe('Read article');
      });

      it('should handle multiple markdown links in extract mode', async () => {
        const t = {
          ...TASK,
          title: '[Site1](https://a.com) and [Site2](https://b.com)',
        };
        const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'extract' });
        expect(r).toBeDefined();
        expect(r?.attachments.length).toBe(2);
        expect(r?.attachments[0].path).toBe('https://a.com');
        expect(r?.attachments[1].path).toBe('https://b.com');
        expect(r?.taskChanges.title).toBe('Site1 and Site2');
      });

      it('should handle mixed markdown link and plain URL in extract mode', async () => {
        const t = {
          ...TASK,
          title: '[docs](https://a.com) and https://b.com',
        };
        const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'extract' });
        expect(r).toBeDefined();
        expect(r?.attachments.length).toBe(2);
        expect(r?.attachments[0].path).toBe('https://a.com');
        expect(r?.attachments[1].path).toBe('https://b.com');
        expect(r?.taskChanges.title).toBe('docs and');
      });

      // The stripped characters are the '[' and the '](url)' — the display
      // text stays, so the highlight must cover the brackets, not the label.
      it('should highlight the stripped markdown syntax around the display text', async () => {
        const title = 'Check [docs](https://example.com/docs) for details';
        const r = await shortSyntax(
          { ...TASK, title },
          { ...CONFIG, urlBehavior: 'extract' },
        );
        expect(r?.parsedRanges).toEqual([
          { type: 'url', start: 6, end: 7 },
          { type: 'url', start: 11, end: 38 },
        ]);
        expect(title.slice(6, 7)).toBe('[');
        expect(title.slice(11, 38)).toBe('](https://example.com/docs)');
      });

      it('should highlight markdown syntax and a plain URL in the same title', async () => {
        const title = '[docs](https://a.com) and https://b.com';
        const r = await shortSyntax(
          { ...TASK, title },
          { ...CONFIG, urlBehavior: 'extract' },
        );
        expect(r?.parsedRanges).toEqual([
          { type: 'url', start: 0, end: 1 },
          { type: 'url', start: 5, end: 21 },
          { type: 'url', start: 26, end: 39 },
        ]);
        expect(title.slice(5, 21)).toBe('](https://a.com)');
        expect(title.slice(26, 39)).toBe('https://b.com');
      });

      it('should not touch the title when a markdown link carries no URL', async () => {
        const r = await shortSyntax(
          { ...TASK, title: 'Add [Website]()' },
          { ...CONFIG, urlBehavior: 'extract' },
        );
        expect(r).toBeUndefined();
      });

      // A URL-less link must survive whether or not the title happens to hold
      // another URL — otherwise unrelated text decides if the user keeps those
      // characters, and nothing is extracted in exchange for dropping them.
      it('should keep a URL-less markdown link when another URL is extracted', async () => {
        const title = 'Add [Website]() https://a.com';
        const r = await shortSyntax(
          { ...TASK, title },
          { ...CONFIG, urlBehavior: 'extract' },
        );
        expect(r?.attachments.length).toBe(1);
        expect(r?.attachments[0].path).toBe('https://a.com');
        expect(r?.taskChanges.title).toBe('Add [Website]()');
        expect(r?.parsedRanges).toEqual([{ type: 'url', start: 16, end: 29 }]);
        expect(title.slice(16, 29)).toBe('https://a.com');
      });

      it('should collapse only the markdown links that carry a URL', async () => {
        const title = '[a]() [b](https://b.com)';
        const r = await shortSyntax(
          { ...TASK, title },
          { ...CONFIG, urlBehavior: 'extract' },
        );
        expect(r?.attachments.length).toBe(1);
        expect(r?.attachments[0].path).toBe('https://b.com');
        expect(r?.taskChanges.title).toBe('[a]() b');
        expect(r?.parsedRanges).toEqual([
          { type: 'url', start: 6, end: 7 },
          { type: 'url', start: 8, end: 24 },
        ]);
        expect(title.slice(8, 24)).toBe('](https://b.com)');
      });
    });
  });

  // Positions come from the parser's offset map, not from searching the raw
  // text — these inputs are exactly the ones where searching guesses wrong
  describe('parsedRanges position tracking', () => {
    it('should not highlight an estimate inside a tag', async () => {
      const t = {
        ...TASK,
        title: '#1h retro 1h',
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);
      expect(r?.taskChanges.title).toBe('retro');
      expect(r?.newTagTitles).toEqual(['1h']);
      expect(r?.parsedRanges).toEqual([
        { type: 'tag', start: 0, end: 3 },
        { type: 'estimate', start: 10, end: 12 },
      ]);
    });

    it('should not highlight an estimate inside a URL', async () => {
      const t = {
        ...TASK,
        title: 'Read https://ex.com/30m-guide later 30m',
      };
      const r = await shortSyntax(t, { ...CONFIG, urlBehavior: 'extract' });
      expect(r?.taskChanges.title).toBe('Read later');
      expect(r?.parsedRanges).toEqual([
        { type: 'url', start: 5, end: 29 },
        { type: 'estimate', start: 36, end: 39 },
      ]);
    });

    it('should split a due range around an earlier estimate removal', async () => {
      const t = {
        ...TASK,
        title: 'Call Bob @tomorrow 1h evening',
      };
      const now = new Date(2024, 0, 15, 10, 0, 0, 0);
      const r = await shortSyntax(t, CONFIG, undefined, undefined, now);
      expect(r?.taskChanges.title).toBe('Call Bob');
      expect(r?.parsedRanges).toEqual([
        { type: 'due', start: 9, end: 18 },
        { type: 'estimate', start: 19, end: 21 },
        { type: 'due', start: 22, end: 29 },
      ]);
    });

    it('should locate duplicate tag texts at distinct positions', async () => {
      const t = {
        ...TASK,
        title: 'A #blu #blu',
      };
      const r = await shortSyntax(t, CONFIG, ALL_TAGS);
      expect(r?.parsedRanges).toEqual([
        { type: 'tag', start: 2, end: 6 },
        { type: 'tag', start: 7, end: 11 },
      ]);
    });
  });
});

describe('parseTimeSpentChanges', () => {
  it('should parse time estimate from title', () => {
    const result = parseTimeSpentChanges({ title: 'Subtask 30m' });
    expect(result.timeEstimate).toBe(30 * 60 * 1000);
    expect(result.title).toBe('Subtask');
  });

  it('should parse time spent and estimate from title', () => {
    const result = parseTimeSpentChanges({ title: 'Subtask 10m/1h' });
    expect(result.timeEstimate).toBe(60 * 60 * 1000);
    expect(result.timeSpentOnDay?.[getDbDateStr()]).toBe(10 * 60 * 1000);
    expect(result.title).toBe('Subtask');
  });

  it('should return empty object for title without time syntax', () => {
    const result = parseTimeSpentChanges({ title: 'Just a regular subtask' });
    expect(result).toEqual({});
  });

  it('should return empty object when title is undefined', () => {
    const result = parseTimeSpentChanges({});
    expect(result).toEqual({});
  });

  it('should return empty object for empty string title', () => {
    const result = parseTimeSpentChanges({ title: '' });
    expect(result).toEqual({});
  });

  it('should handle time-only title', () => {
    const result = parseTimeSpentChanges({ title: '2h' });
    expect(result.timeEstimate).toBe(2 * 60 * 60 * 1000);
    expect(result.title).toBe('');
  });

  it('should work without timeSpentOnDay on the input', () => {
    const result = parseTimeSpentChanges({ title: 'Task 15m/' });
    expect(result.timeSpentOnDay?.[getDbDateStr()]).toBe(15 * 60 * 1000);
    expect(result.title).toBe('Task');
  });
});

describe('shortSyntax recurrence', () => {
  // Wed Jan 17 2024, 10:00 local time
  const NOW = new Date(2024, 0, 17, 10, 0, 0, 0);

  const parse = async (title: string, now: Date = NOW): ReturnType<typeof shortSyntax> =>
    shortSyntax({ ...TASK, title }, CONFIG, [], [], now, 'combine', true);

  it('should parse "@every friday" as weekly repeat anchored to next friday', async () => {
    const r = await parse('Water plants @every friday');
    expect(r?.repeatQuickSetting).toBe('WEEKLY_CURRENT_WEEKDAY');
    expect(r?.taskChanges.title).toBe('Water plants');
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDay()).toBe(5);
    expect(due.getTime()).toBeGreaterThan(NOW.getTime());
    expect(r?.taskChanges.hasPlannedTime).toBe(false);
  });

  it('should keep today as anchor when "@every wednesday" matches the current weekday', async () => {
    const r = await parse('Standup @every wednesday');
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDay()).toBe(3);
    expect(due.getDate()).toBe(17);
  });

  it('should parse weekday abbreviations and plurals', async () => {
    for (const syntax of ['@every fri', '@every fridays', '@every Fri']) {
      const r = await parse(`Water plants ${syntax}`);
      expect(r?.repeatQuickSetting).toBe('WEEKLY_CURRENT_WEEKDAY');
      const due = new Date(r?.taskChanges.dueWithTime as number);
      expect(due.getDay()).toBe(5);
    }
  });

  it('should parse "@every friday 3pm" with a start time', async () => {
    const r = await parse('Team call @every friday 3pm');
    expect(r?.repeatQuickSetting).toBe('WEEKLY_CURRENT_WEEKDAY');
    expect(r?.taskChanges.title).toBe('Team call');
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDay()).toBe(5);
    expect(due.getHours()).toBe(15);
    expect(r?.taskChanges.hasPlannedTime).toBeUndefined();
  });

  it('should parse "@daily" as daily repeat without an anchor date', async () => {
    const r = await parse('Journal @daily');
    expect(r?.repeatQuickSetting).toBe('DAILY');
    expect(r?.taskChanges.title).toBe('Journal');
    expect(r?.taskChanges.dueWithTime).toBeUndefined();
  });

  it('should parse "@daily 6am" with a time anchor', async () => {
    const r = await parse('Journal @daily 6am');
    expect(r?.repeatQuickSetting).toBe('DAILY');
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getHours()).toBe(6);
  });

  it('should NOT parse interval phrases like "@every 2 weeks" as recurrence', async () => {
    // The quick-setting presets all mean an interval of 1 and the repeat
    // dialog cannot express or preserve any other interval on a preset —
    // interval phrases fall through to the plain-date path instead
    for (const title of ['Review @every 2 weeks', 'Water flowers @every 3 days']) {
      const r = await parse(title);
      expect(r?.repeatQuickSetting ?? null)
        .withContext(title)
        .toBeNull();
    }
  });

  it('should parse "@every weekday" as monday through friday', async () => {
    const r = await parse('Standup @every weekday');
    expect(r?.repeatQuickSetting).toBe('MONDAY_TO_FRIDAY');
  });

  it('should parse "@every 15th" as monthly on next 15th', async () => {
    const r = await parse('Pay rent @every 15th', new Date(2024, 0, 20, 10, 0));
    expect(r?.repeatQuickSetting).toBe('MONTHLY_CURRENT_DATE');
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDate()).toBe(15);
    expect(due.getMonth()).toBe(1);
  });

  it('should anchor "@every 15th" to the current month when still upcoming', async () => {
    const r = await parse('Pay rent @every 15th', new Date(2024, 0, 10, 10, 0));
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDate()).toBe(15);
    expect(due.getMonth()).toBe(0);
  });

  it('should parse "@every month" and "@monthly" as monthly without anchor', async () => {
    for (const syntax of ['@every month', '@monthly']) {
      const r = await parse(`Backup ${syntax}`);
      expect(r?.repeatQuickSetting).toBe('MONTHLY_CURRENT_DATE');
      expect(r?.taskChanges.dueWithTime).toBeUndefined();
    }
  });

  it('should parse "@yearly" and "@every year" as yearly', async () => {
    for (const syntax of ['@yearly', '@every year', '@annually']) {
      const r = await parse(`Checkup ${syntax}`);
      expect(r?.repeatQuickSetting).toBe('YEARLY_CURRENT_DATE');
    }
  });

  it('should work combined with tags', async () => {
    const r = await shortSyntax(
      { ...TASK, title: 'Water plants #blu @every sunday' },
      CONFIG,
      ALL_TAGS,
      [],
      NOW,
      'combine',
      true,
    );
    expect(r?.repeatQuickSetting).toBe('WEEKLY_CURRENT_WEEKDAY');
    expect(r?.taskChanges.tagIds).toEqual(['blu_id']);
    expect(r?.taskChanges.title).toBe('Water plants');
  });

  it('should NOT parse recurrence when isParseRepeat is false (title-edit path)', async () => {
    const r = await shortSyntax(
      { ...TASK, title: 'Water plants @every friday' },
      CONFIG,
      [],
      [],
      NOW,
    );
    expect(r?.repeatQuickSetting).toBeNull();
    // chrono still finds the date within the phrase, as before this feature
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDay()).toBe(5);
  });

  it('should NOT parse a plain "@friday" as recurrence', async () => {
    const r = await parse('Water plants @friday');
    expect(r?.repeatQuickSetting).toBeNull();
    expect(r?.taskChanges.dueWithTime).toBeDefined();
  });

  it('should NOT parse deadline syntax "!every friday" as recurrence', async () => {
    const r = await parse('Taxes !every friday');
    expect(r?.repeatQuickSetting).toBeNull();
  });

  it('should NOT treat a recurrence phrase mid-match as recurrence', async () => {
    const r = await parse('Meet @friday every week');
    expect(r?.repeatQuickSetting).toBeNull();
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDay()).toBe(5);
  });

  it('should NOT match an incomplete "@every"', async () => {
    const r = await parse('Task @every');
    expect(r?.repeatQuickSetting ?? null).toBeNull();
  });

  it('should NOT match words merely starting with a frequency word', async () => {
    const r = await parse('Meet @dailystandup');
    expect(r?.repeatQuickSetting ?? null).toBeNull();
  });

  it('should tolerate trailing punctuation after the phrase', async () => {
    for (const title of [
      'Water plants @every friday.',
      'Water plants @every friday,',
      'Journal @daily.',
    ]) {
      const r = await parse(title);
      expect(r?.repeatQuickSetting)
        .withContext(title)
        .toBe(title.includes('daily') ? 'DAILY' : 'WEEKLY_CURRENT_WEEKDAY');
    }
  });

  it('should join tolerated trailing punctuation to the preceding word', async () => {
    const expected: [string, string][] = [
      ['Water plants @every friday.', 'Water plants.'],
      ['Water plants @every friday,', 'Water plants,'],
      ['Buy milk @every friday, then rest', 'Buy milk, then rest'],
    ];
    for (const [title, cleaned] of expected) {
      const r = await parse(title);
      expect(r?.taskChanges.title).withContext(title).toBe(cleaned);
    }
  });

  it('should only absorb a chrono match directly following the phrase', async () => {
    const r = await parse('@every friday call mom tomorrow');
    expect(r?.repeatQuickSetting).toBe('WEEKLY_CURRENT_WEEKDAY');
    expect(r?.taskChanges.title).toBe('call mom tomorrow');
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDay()).toBe(5);
  });

  it('should keep words between the phrase and a later date expression', async () => {
    const r = await parse('Standup @every monday and friday');
    expect(r?.repeatQuickSetting).toBe('WEEKLY_CURRENT_WEEKDAY');
    expect(r?.taskChanges.title).toBe('Standup and friday');
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDay()).toBe(1);
  });

  it('should not leave a double space when absorbing an adjacent date mid-title', async () => {
    const r = await parse('Review @every week monday notes');
    expect(r?.repeatQuickSetting).toBe('WEEKLY_CURRENT_WEEKDAY');
    expect(r?.taskChanges.title).toBe('Review notes');
  });

  it('should advance a weekly anchor one week when the time today is already past', async () => {
    // Friday 17:00 — "@every friday 3pm" must not be due 2h in the past
    const r = await parse('Team call @every friday 3pm', new Date(2024, 0, 19, 17, 0));
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDate()).toBe(26);
    expect(due.getDay()).toBe(5);
    expect(due.getHours()).toBe(15);
  });

  it('should keep a same-day weekly anchor when the time is still ahead', async () => {
    const r = await parse('Team call @every friday 3pm', new Date(2024, 0, 19, 10, 0));
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDate()).toBe(19);
    expect(due.getHours()).toBe(15);
  });

  it('should advance a monthly anchor one month when the time today is already past', async () => {
    const r = await parse('Pay rent @every 15th 3pm', new Date(2024, 0, 15, 17, 0));
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getMonth()).toBe(1);
    expect(due.getDate()).toBe(15);
    expect(due.getHours()).toBe(15);
  });

  // The *_CURRENT_* presets take their recurring weekday / day-of-month from
  // the first occurrence, so an already-passed time must roll a whole period —
  // letting chrono's forwardDate move it to tomorrow would silently change what
  // "@weekly" recurs on, depending only on the time of day it was typed.
  it('should keep today\'s weekday for "@weekly 6am" typed after 6am', async () => {
    // Wed Jan 17 10:00
    const r = await parse('Journal @weekly 6am');
    expect(r?.repeatQuickSetting).toBe('WEEKLY_CURRENT_WEEKDAY');
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDay()).toBe(3);
    expect(due.getDate()).toBe(24);
    expect(due.getHours()).toBe(6);
  });

  it('should keep today as the "@weekly 6am" anchor when 6am is still ahead', async () => {
    const r = await parse('Journal @weekly 6am', new Date(2024, 0, 17, 3, 0));
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDay()).toBe(3);
    expect(due.getDate()).toBe(17);
    expect(due.getHours()).toBe(6);
  });

  it('should keep today\'s day-of-month for "@monthly 6am" typed after 6am', async () => {
    const r = await parse('Report @monthly 6am');
    expect(r?.repeatQuickSetting).toBe('MONTHLY_CURRENT_DATE');
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getMonth()).toBe(1);
    expect(due.getDate()).toBe(17);
    expect(due.getHours()).toBe(6);
  });

  it('should keep today\'s date for "@yearly 6am" typed after 6am', async () => {
    const r = await parse('Renew domain @yearly 6am');
    expect(r?.repeatQuickSetting).toBe('YEARLY_CURRENT_DATE');
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getFullYear()).toBe(2025);
    expect(due.getMonth()).toBe(0);
    expect(due.getDate()).toBe(17);
    expect(due.getHours()).toBe(6);
  });

  it('should skip a month lacking the anchor day when rolling "@monthly 6am" forward', async () => {
    // Wed Jan 31 12:00 — February has no 31st, and clamping to Feb 29 would
    // make the repeat engine recur on the 29th from then on
    const r = await parse('Report @monthly 6am', new Date(2024, 0, 31, 12, 0));
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getMonth()).toBe(2);
    expect(due.getDate()).toBe(31);
    expect(due.getHours()).toBe(6);
  });

  it('should still let an explicit day beat the implied "@weekly" anchor', async () => {
    const r = await parse('Journal @weekly monday');
    expect(r?.repeatQuickSetting).toBe('WEEKLY_CURRENT_WEEKDAY');
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDay()).toBe(1);
  });

  it('should leave "@daily 6am" on chrono\'s next-day roll', async () => {
    const r = await parse('Journal @daily 6am');
    expect(r?.repeatQuickSetting).toBe('DAILY');
    const due = new Date(r?.taskChanges.dueWithTime as number);
    expect(due.getDate()).toBe(18);
    expect(due.getHours()).toBe(6);
  });
});
