import { TaskCopy } from './task.model';
import { shortSyntax } from './short-syntax';
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

const getPlannedDateTimestampFromShortSyntaxReturnValue = (
  taskInput: TaskCopy,
  now: Date = new Date(),
): number => {
  const r = shortSyntax(taskInput, CONFIG, undefined, undefined, now);
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
  it('should ignore for no short syntax', () => {
    const r = shortSyntax(TASK, CONFIG);
    expect(r).toEqual(undefined);
  });

  it('should ignore if the changes cause no further changes', () => {
    const r = shortSyntax(
      {
        ...TASK,
        title: 'So what shall I do',
      },
      CONFIG,
    );
    expect(r).toEqual(undefined);
  });

  describe('should work for time short syntax', () => {
    it('', () => {
      const t = {
        ...TASK,
        title: 'Fun title 10m/1h',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
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

    it('', () => {
      const t = {
        ...TASK,
        title: 'Fun title whatever 1h/120m',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
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

    it('', () => {
      const t = {
        ...TASK,
        title: 'Fun title whatever 1.5h',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title whatever',
          timeEstimate: 5400000,
        },
      });
    });

    it('', () => {
      const t = {
        ...TASK,
        title: 'Fun title whatever 1.5h/2.5h',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
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

    it('should ignore time short syntax when disabled', () => {
      const t = {
        ...TASK,
        title: 'Fun title whatever 1h/120m',
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableDue: false });
      expect(r).toEqual(undefined);
    });

    it('with time spent only', () => {
      const t = {
        ...TASK,
        title: 'Task description 30m/',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
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
    it('should correctly parse schedule syntax with time only', () => {
      const t = {
        ...TASK,
        title: 'Test @4pm',
      };
      // Use fixed date at 10am to avoid race conditions with real system time
      // and ensure we're safely before 4pm for same-day scheduling
      const now = new Date(2024, 0, 15, 10, 0, 0, 0); // Jan 15, 2024 at 10:00 AM
      const parsedDateInMilliseconds = getPlannedDateTimestampFromShortSyntaxReturnValue(
        t,
        now,
      );
      const parsedDate = new Date(parsedDateInMilliseconds);
      const isSetToSameDay = checkSameDay(parsedDate, now);
      expect(isSetToSameDay).toBeTrue();
      const isTimeSetCorrectly = checkIfDateHasCorrectTime(parsedDate, 16, 0);
      expect(isTimeSetCorrectly).toBeTrue();
    });

    it('should ignore schedule syntax with time only when disabled', () => {
      const t = {
        ...TASK,
        title: 'Test @4pm',
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableDue: false });
      expect(r).toEqual(undefined);
    });

    it('should ignore day of the week when disabled', () => {
      const t = {
        ...TASK,
        title: 'Test @Friday',
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableDue: false });
      expect(r).toEqual(undefined);
    });

    it('should correctly parse day of the week', () => {
      const t = {
        ...TASK,
        title: 'Test @Friday',
      };
      const now = new Date('Fri Feb 09 2024 11:31:29 ');
      const parsedDateInMilliseconds = getPlannedDateTimestampFromShortSyntaxReturnValue(
        t,
        now,
      );
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

    it('should properly remove date syntax when there is a space after @', () => {
      const t = {
        ...TASK,
        title: 'Test @ tomorrow 19:00',
      };
      // set a fixed date to avoid test flakiness
      const now = new Date('2025-12-05T10:00:00');
      const r = shortSyntax(t, CONFIG, undefined, undefined, now);

      expect(r?.taskChanges.title).toBe('Test');
      expect(r?.taskChanges.dueDay).toBeNull();
    });

    it('should properly remove date syntax when there is a space after @ for simple number', () => {
      const t = {
        ...TASK,
        title: 'Test @ 4',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r?.taskChanges.title).toBe('Test');
      expect(r?.taskChanges.dueDay).toBeNull();
    });

    it('should properly remove date syntax with date format like 12/20/25', () => {
      const t = {
        ...TASK,
        title: 'Test @ 12/20/25 19:00',
      };
      const now = new Date('2025-12-05T10:00:00');
      const r = shortSyntax(t, CONFIG, undefined, undefined, now);

      expect(r?.taskChanges.title).toBe('Test');
      expect(r?.taskChanges.dueDay).toBeNull();
      expect(r?.taskChanges.dueWithTime).toBeDefined();
      // Verify it's scheduled for the future (Dec 20, 2025 at 19:00)
      const scheduledDate = new Date(r?.taskChanges.dueWithTime as number);
      expect(scheduledDate.getMonth()).toBe(11); // December (0-indexed)
      expect(scheduledDate.getDate()).toBe(20);
      expect(scheduledDate.getHours()).toBe(19);
    });

    it('should schedule overdue task to future when using inline @ syntax', () => {
      const t = {
        ...TASK,
        title: 'Overdue task @tomorrow 14:00',
        dueDay: '2025-12-01', // Simulating an overdue task
      };
      const now = new Date('2025-12-05T10:00:00');
      const r = shortSyntax(t, CONFIG, undefined, undefined, now);

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
  });

  describe('tags', () => {
    it('should not trigger for tasks with starting # (e.g. github issues)', () => {
      const t = {
        ...TASK,
        title: '#134 Fun title',
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should not trigger for tasks with starting # (e.g. github issues) when disabled', () => {
      const t = {
        ...TASK,
        title: '#134 Fun title',
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should not parse numeric tag when it is the first word in the title', () => {
      const t = {
        ...TASK,
        title: '#123 Task description',
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should not trigger for tasks with starting # (e.g. github issues) when adding tags', () => {
      const t = {
        ...TASK,
        title: '#134 Fun title #blu',
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: '#134 Fun title',
          tagIds: ['blu_id'],
        },
      });
    });

    it('should not trigger for multiple tasks when disabled', () => {
      const t = {
        ...TASK,
        title: '#134 Fun title #blu',
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should add tag when it is the first word in the title', () => {
      const t = {
        ...TASK,
        title: '#blu Fun title',
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          tagIds: ['blu_id'],
        },
      });
    });

    it('should add multiple tags even if the first tag is at the beginning', () => {
      const t = {
        ...TASK,
        title: '#blu #hihi Fun title',
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          tagIds: ['blu_id', 'hihi_id'],
        },
      });
    });

    it('should work with tags', () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #A',
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          tagIds: ['blu_id', 'A_id'],
        },
      });
    });

    it("shouldn't work with tags when disabled", () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #A',
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should not trigger for # without space before', () => {
      const t = {
        ...TASK,
        title: 'Fun title#blu',
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should not trigger for # without space before but parse other tags', () => {
      const t = {
        ...TASK,
        title: 'Fun title#blu #bla',
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title#blu',
          tagIds: ['bla_id'],
        },
      });
    });

    it('should not overwrite existing tags', () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #hihi',
        tagIds: ['blu_id', 'A', 'multi_word_id'],
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          tagIds: ['blu_id', 'A', 'multi_word_id', 'hihi_id'],
        },
      });
    });

    it('should not overwrite existing tags when disabled', () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #hihi',
        tagIds: ['blu_id', 'A', 'multi_word_id'],
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should add new tag names', () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #idontexist',
        tagIds: [],
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: ['idontexist'],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          tagIds: ['blu_id'],
        },
      });
    });

    it('should not add new tag names when disabled', () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #idontexist',
        tagIds: [],
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should remove tags not existing on title', () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #bla',
        tagIds: ['blu_id', 'bla_id', 'hihi_id'],
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS, undefined, undefined, 'replace');

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title',
          tagIds: ['blu_id', 'bla_id'],
        },
      });
    });

    it('should not remove tags not existing on title when disabled', () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu #bla',
        tagIds: ['blu_id', 'bla_id', 'hihi_id'],
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should add new "asd #asd" tag', () => {
      const t = {
        ...TASK,
        title: 'asd #asd',
        tagIds: [],
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: ['asd'],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'asd',
        },
      });
    });

    it('should work for edge case #3728', () => {
      const t = {
        ...TASK,
        title: 'Test tag error #testing #someNewTag3',
        tagIds: [],
      };
      const r = shortSyntax(t, CONFIG, [
        ...ALL_TAGS,
        { ...DEFAULT_TAG, id: 'testing_id', title: 'testing' },
      ]);

      expect(r).toEqual({
        newTagTitles: ['someNewTag3'],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Test tag error',
          tagIds: ['testing_id'],
        },
      });
    });

    it('should not add new "asd #asd" tag when disabled', () => {
      const t = {
        ...TASK,
        title: 'asd #asd',
        tagIds: [],
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should add tags for sub tasks', () => {
      const t = {
        ...TASK,
        parentId: 'SOMEPARENT',
        title: 'Fun title #blu #idontexist',
        tagIds: [],
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);

      expect(r).toEqual({
        newTagTitles: ['idontexist'],
        projectId: undefined,
        attachments: [],
        remindAt: null,
        taskChanges: { tagIds: ['blu_id'], title: 'Fun title' },
      });
    });

    it('should not add tags for sub tasks when disabled', () => {
      const t = {
        ...TASK,
        parentId: 'SOMEPARENT',
        title: 'Fun title #blu #idontexist',
        tagIds: [],
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });

    it('should remove tag from title if task already has tag', () => {
      const t = {
        ...TASK,
        title: 'Test tag #testing',
        tagIds: ['testing_id'],
      };
      const r = shortSyntax(t, CONFIG, [
        ...ALL_TAGS,
        { ...DEFAULT_TAG, id: 'testing_id', title: 'testing' },
      ]);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Test tag',
        },
      });
    });

    it('should create new tag and remove both from title if task already has one given tag', () => {
      const t = {
        ...TASK,
        title: 'Test tag #testing #blu',
        tagIds: ['blu_id'],
      };
      const r = shortSyntax(t, CONFIG, [
        ...ALL_TAGS,
        { ...DEFAULT_TAG, id: 'blu_id', title: 'blu' },
      ]);

      expect(r).toEqual({
        newTagTitles: ['testing'],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Test tag',
        },
      });
    });

    it('should add existing tag and remove both from title if task already has one given tag', () => {
      const t = {
        ...TASK,
        title: 'Test tag #testing #blu',
        tagIds: ['blu_id'],
      };
      const r = shortSyntax(t, CONFIG, [
        ...ALL_TAGS,
        { ...DEFAULT_TAG, id: 'blu_id', title: 'blu' },
        { ...DEFAULT_TAG, id: 'testing_id', title: 'testing' },
      ]);

      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Test tag',
          tagIds: ['blu_id', 'testing_id'],
        },
      });
    });

    it('should not remove tag from title if task already has tag when disabled', () => {
      const t = {
        ...TASK,
        title: 'Test tag #testing',
        tagIds: ['testing_id'],
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);

      expect(r).toEqual(undefined);
    });
  });
  describe('should work with tags and time estimates combined', () => {
    it('tag before time estimate', () => {
      const t = {
        ...TASK,
        title: 'Fun title #blu 10m/1h',
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
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

    it('time estimate before tag', () => {
      const t = {
        ...TASK,
        title: 'Fun title 10m/1h #blu',
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
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

    it('time estimate disabled', () => {
      const t = {
        ...TASK,
        title: 'Fun title 10m/1h #blu',
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableDue: false }, ALL_TAGS);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: undefined,
        attachments: [],
        taskChanges: {
          title: 'Fun title 10m/1h',
          tagIds: ['blu_id'],
        },
      });
    });

    it('tags disabled', () => {
      const t = {
        ...TASK,
        title: 'Fun title 10m/1h #blu',
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableTag: false }, ALL_TAGS);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
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

    it('should work', () => {
      const t = {
        ...TASK,
        title: 'Fun title +ProjectEasyShort',
      };
      const r = shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: 'ProjectEasyShortID',
        attachments: [],
        taskChanges: {
          title: 'Fun title',
        },
      });
    });

    it("shouldn't work when disabled", () => {
      const t = {
        ...TASK,
        title: 'Fun title +ProjectEasyShort',
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableProject: false }, [], projects);
      expect(r).toEqual(undefined);
    });

    it('should not parse without missing whitespace before', () => {
      const t = {
        ...TASK,
        title: 'Fun title+ProjectEasyShort',
      };
      const r = shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual(undefined);
    });

    it('should work together with time estimates', () => {
      const t = {
        ...TASK,
        title: 'Fun title +ProjectEasyShort 10m/1h',
      };
      const r = shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
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

    it('should work together with time estimates when disabled', () => {
      const t = {
        ...TASK,
        title: 'Fun title +ProjectEasyShort 10m/1h',
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableProject: false }, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
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

    it('should work together with disabled time estimates', () => {
      const t = {
        ...TASK,
        title: 'Fun title +ProjectEasyShort 10m/1h',
      };
      const r = shortSyntax(t, { ...CONFIG, isEnableDue: false }, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: 'ProjectEasyShortID',
        attachments: [],
        taskChanges: {
          title: 'Fun title 10m/1h',
        },
      });
    });

    it('should work with only the beginning of a project title if it is at least 3 chars long', () => {
      const t = {
        ...TASK,
        title: 'Fun title +Project',
      };
      const r = shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: 'ProjectEasyShortID',
        attachments: [],
        taskChanges: {
          title: 'Fun title',
        },
      });
    });

    it('should work with multi word project titles', () => {
      const t = {
        ...TASK,
        title: 'Fun title +Some Project Title',
      };
      const r = shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: 'SomeProjectID',
        attachments: [],
        taskChanges: {
          title: 'Fun title',
        },
      });
    });

    it('should work with multi word project titles partial', () => {
      const t = {
        ...TASK,
        title: 'Fun title +Some Pro',
      };
      const r = shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: 'SomeProjectID',
        attachments: [],
        taskChanges: {
          title: 'Fun title',
        },
      });
    });

    it('should work with multi word project titles partial written without white space', () => {
      const t = {
        ...TASK,
        title: 'Other fun title +SomePro',
      };
      const r = shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: 'SomeProjectID',
        attachments: [],
        taskChanges: {
          title: 'Other fun title',
        },
      });
    });

    it('should ignore non existing', () => {
      const t = {
        ...TASK,
        title: 'Other fun title +Non existing project',
      };
      const r = shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual(undefined);
    });

    it('should prefer shortest prefix full project title match', () => {
      const t = {
        ...TASK,
        title: 'Task +print',
      };
      projects = ['printer', 'imprints', 'print', 'printable'].map(
        (title) => ({ id: title, title }) as Project,
      );
      const r = shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
        projectId: 'print',
        attachments: [],
        taskChanges: {
          title: 'Task',
        },
      });
    });
  });

  describe('combined', () => {
    it('should work when time comes first', () => {
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
      const r = shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: [],
        remindAt: null,
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

    it('should work for project first', () => {
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
      const r = shortSyntax(t, CONFIG, [], projects);
      expect(r).toEqual({
        newTagTitles: ['tag'],
        remindAt: null,
        projectId: 'ProjectEasyShortID',
        attachments: [],
        taskChanges: {
          title: 'Some task',
          // timeSpent: 7200000,
          timeEstimate: 1800000,
        },
      });
    });
    it('should correctly parse scheduled date, project, time spent and estimate', () => {
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
        getPlannedDateTimestampFromShortSyntaxReturnValue(t);
      const parsedDate = new Date(parsedDateInMilliseconds);
      // The parsed day and time should be Friday, or 5, and time is 16 hours and 0 minute
      expect(parsedDate.getDay()).toEqual(5);
      const isTimeSetCorrectly = checkIfDateHasCorrectTime(parsedDate, 16, 0);
      expect(isTimeSetCorrectly).toBeTrue();
      const parsedTaskInfo = shortSyntax(t, CONFIG, [], projects);
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
    it('should correctly parse scheduled date and multiple tags', () => {
      const t = {
        ...TASK,
        title: 'Test @fri 4pm #html #css',
      };
      const plannedTimestamp = getPlannedDateTimestampFromShortSyntaxReturnValue(t);
      const isPlannedDateAndTimeCorrect = checkIfCorrectDateAndTime(
        plannedTimestamp,
        'friday',
        16,
        0,
      );
      expect(isPlannedDateAndTimeCorrect).toBeTrue();
      const parsedTaskInfo = shortSyntax(t, CONFIG, []);
      expect(parsedTaskInfo?.newTagTitles.includes('html')).toBeTrue();
      expect(parsedTaskInfo?.newTagTitles.includes('css')).toBeTrue();
    });

    it('should parse scheduled date using local time zone when unspecified', () => {
      const t = {
        ...TASK,
        title: '@2030-10-12T13:37',
      };
      const plannedTimestamp = getPlannedDateTimestampFromShortSyntaxReturnValue(t);
      expect(checkIfCorrectDateAndTime(plannedTimestamp, 'saturday', 13, 37)).toBeTrue();
    });

    it('should work when all are disabled', () => {
      const t = {
        ...TASK,
        title: 'Test @fri 4pm #html #css +ProjectEasyShort',
      };
      const r = shortSyntax(t, {
        isEnableDue: false,
        isEnableProject: false,
        isEnableTag: false,
      });
      expect(r).toEqual(undefined);
    });
  });

  describe('projects using special delimiters', () => {
    const taskTemplates = [
      'Task *',
      'Task * 10m',
      'Task * 1h / 2d',
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
        it(`should parse project "${project.title}" from "${taskTitle}"`, () => {
          const task = {
            ...TASK,
            title: taskTitle,
          };
          const result = shortSyntax(task, CONFIG, ALL_TAGS, projects);
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

    it('should correctly parse year and time estimate when the input date only has month and day of the month', () => {
      const tomorrow = new Date(today.getTime() + oneDayInMilliseconds);
      const inputMonth = tomorrow.getMonth() + 1;
      const inputMonthName = MONTH_SHORT_NAMES[tomorrow.getMonth()];
      const inputDayOfTheMonth = tomorrow.getDate();
      const t = {
        ...TASK,
        title: `Test @${inputMonthName} ${inputDayOfTheMonth} ${minuteEstimate}m`,
      };
      const parsedTaskInfo = shortSyntax(t, CONFIG, []);
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

    it('should correctly parse year and time estimate when the input date contains month, day of the month and time', () => {
      const time = '4pm';
      const tomorrow = new Date(today.getTime() + oneDayInMilliseconds);
      const inputMonth = tomorrow.getMonth() + 1;
      const inputMonthName = MONTH_SHORT_NAMES[tomorrow.getMonth()];
      const inputDayOfTheMonth = tomorrow.getDate();
      const t = {
        ...TASK,
        title: `Test @${inputMonthName} ${inputDayOfTheMonth} ${time} ${minuteEstimate}m`,
      };
      const parsedTaskInfo = shortSyntax(t, CONFIG, []);
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
      ['1d2h5m', 1565, undefined],
      ['1h 30m /', undefined, 90],
      ['1d2h5m/', undefined, 1565],
      ['1h 30m / 1d 12h', 2160, 90],
      ['1.25h / 0.5d 1h 4m', 784, 75],
      ['1d2h5m/3d', 4320, 1565],
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
      } from "${title}"`, () => {
        const task = {
          ...TASK,
          title,
        };
        const result = shortSyntax(task, CONFIG, [], []);
        expect(result?.taskChanges.timeEstimate).toBe(timeEstimate);
        expect(result?.taskChanges.timeSpentOnDay?.[getDbDateStr()]).toBe(timeSpentOnDay);
      });
    }
  });

  describe('URL attachments', () => {
    it('should extract single URL with https protocol', () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('https://example.com');
      expect(r?.attachments[0].type).toBe('LINK');
      expect(r?.attachments[0].icon).toBe('bookmark');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should extract single URL with http protocol', () => {
      const t = {
        ...TASK,
        title: 'Task http://example.com',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('http://example.com');
      expect(r?.attachments[0].type).toBe('LINK');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should extract single URL with file:// protocol', () => {
      const t = {
        ...TASK,
        title: 'Task file:///path/to/document.pdf',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('file:///path/to/document.pdf');
      expect(r?.attachments[0].type).toBe('FILE');
      expect(r?.attachments[0].icon).toBe('insert_drive_file');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should extract single URL with www prefix', () => {
      const t = {
        ...TASK,
        title: 'Task www.example.com',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('//www.example.com');
      expect(r?.attachments[0].type).toBe('LINK');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should handle multiple URLs with mixed protocols', () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com www.test.org file:///home/doc.txt',
      };
      const r = shortSyntax(t, CONFIG);
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

    it('should detect image URLs as IMG type for https', () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com/image.png',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].type).toBe('IMG');
      expect(r?.attachments[0].icon).toBe('image');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should detect image URLs as IMG type for file://', () => {
      const t = {
        ...TASK,
        title: 'Task file:///path/to/image.jpg',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].type).toBe('IMG');
      expect(r?.attachments[0].icon).toBe('image');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should work correctly with combined short syntax', () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com @tomorrow #urgent 30m',
      };
      const r = shortSyntax(t, CONFIG, ALL_TAGS);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('https://example.com');
      expect(r?.taskChanges.title).toBe('Task');
      expect(r?.taskChanges.timeEstimate).toBe(1800000);
      expect(r?.newTagTitles).toContain('urgent');
      expect(r?.taskChanges.dueWithTime).toBeDefined();
    });

    it('should clean URLs from title properly', () => {
      const t = {
        ...TASK,
        title: 'Task with https://example.com in middle',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toBeDefined();
      expect(r?.taskChanges.title).toBe('Task with in middle');
      expect(r?.attachments.length).toBe(1);
    });

    it('should handle Windows file paths', () => {
      const t = {
        ...TASK,
        title: 'Task file:///C:/Users/name/document.pdf',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('file:///C:/Users/name/document.pdf');
      expect(r?.attachments[0].type).toBe('FILE');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should handle Unix file paths', () => {
      const t = {
        ...TASK,
        title: 'Task file:///home/user/document.txt',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('file:///home/user/document.txt');
      expect(r?.attachments[0].type).toBe('FILE');
      expect(r?.taskChanges.title).toBe('Task');
    });

    it('should not parse URLs for issue tasks', () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com',
        issueId: 'ISSUE-123',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toBeUndefined();
    });

    it('should handle URLs with trailing punctuation', () => {
      const t = {
        ...TASK,
        title: 'Check https://example.com.',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('https://example.com');
      expect(r?.taskChanges.title).toBe('Check .');
    });

    it('should extract basename as attachment title', () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com/path/to/file.pdf',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].title).toBe('file');
    });

    it('should extract basename correctly for URLs with trailing slash', () => {
      const t = {
        ...TASK,
        title: 'Task https://example.com/projects/',
      };
      const r = shortSyntax(t, CONFIG);
      expect(r).toBeDefined();
      expect(r?.attachments.length).toBe(1);
      expect(r?.attachments[0].path).toBe('https://example.com/projects/');
      expect(r?.attachments[0].title).toBe('projects');
      expect(r?.taskChanges.title).toBe('Task');
    });
  });
});
