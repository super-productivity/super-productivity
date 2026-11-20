import { parseDueDay, parseGraphData, RawTask } from './from-graph';

const LISTS = [
  { id: 'L1', displayName: 'Tasks', wellknownListName: 'defaultList' },
  { id: 'L2', displayName: 'Groceries', wellknownListName: 'none' },
  { id: 'L3', displayName: 'Flagged email', wellknownListName: 'flaggedEmails' },
];

const parseTasks = (tasks: RawTask[]) =>
  parseGraphData({ lists: LISTS, tasksByListId: { L1: tasks } }).tasks;

describe('parseGraphData', () => {
  it('maps lists, flagging the default and flagged-email lists', () => {
    const model = parseGraphData({ lists: LISTS, tasksByListId: {} });
    expect(model.projects).toEqual([
      { extId: 'L1', title: 'Tasks', isDefault: true, isFlaggedEmails: false },
      { extId: 'L2', title: 'Groceries', isDefault: false, isFlaggedEmails: false },
      { extId: 'L3', title: 'Flagged email', isDefault: false, isFlaggedEmails: true },
    ]);
  });

  it('maps an open task with notes, categories, star, reminder and attachments', () => {
    const [t] = parseTasks([
      {
        id: 'T1',
        title: '  Buy milk ',
        status: 'notStarted',
        importance: 'high',
        body: { content: 'Whole milk\r\n', contentType: 'text' },
        dueDateTime: { dateTime: '2026-12-03T00:00:00.0000000', timeZone: 'UTC' },
        categories: ['Errand', ' '],
        isReminderOn: true,
        hasAttachments: true,
      },
    ]);
    expect(t).toEqual({
      extId: 'T1',
      projectExtId: 'L1',
      parentExtId: null,
      title: 'Buy milk',
      notes: 'Whole milk',
      isDone: false,
      categories: ['Errand'],
      isImportant: true,
      dueDay: '2026-12-03',
      isRecurring: false,
      repeat: null,
      hasReminder: true,
      hasAttachments: true,
    });
  });

  it('skips completed tasks but keeps in-progress and waiting ones', () => {
    const tasks = parseTasks([
      { id: 'a', title: 'done', status: 'completed' },
      { id: 'b', title: 'started', status: 'inProgress' },
      { id: 'c', title: 'waiting', status: 'waitingOnOthers' },
    ]);
    expect(tasks.map((t) => t.title)).toEqual(['started', 'waiting']);
  });

  it('puts steps right after their task as sub-tasks, checked steps done', () => {
    const tasks = parseTasks([
      {
        id: 'T1',
        title: 'Trip',
        checklistItems: [
          { id: 's1', displayName: 'Book flight', isChecked: true },
          { id: 's2', displayName: 'Pack' },
        ],
      },
      { id: 'T2', title: 'Next' },
    ]);
    expect(tasks.map((t) => [t.title, t.parentExtId, t.isDone])).toEqual([
      ['Trip', null, false],
      ['Book flight', 'T1', true],
      ['Pack', 'T1', false],
      ['Next', null, false],
    ]);
    expect(tasks[1].extId).toBe('T1-step-s1');
  });

  it('turns a mappable recurrence into a repeat and keeps the rule for a fallback', () => {
    const [t] = parseTasks([
      {
        id: 'T1',
        title: 'Water plants',
        body: { content: 'Balcony', contentType: 'text' },
        dueDateTime: { dateTime: '2026-12-01T00:00:00.0000000', timeZone: 'UTC' },
        recurrence: { pattern: { type: 'daily', interval: 2 }, range: { type: 'noEnd' } },
      },
    ]);
    expect(t.notes).toBe('Balcony');
    expect(t.isRecurring).toBe(true);
    expect(t.repeat).toEqual({
      schedule: { quickSetting: 'CUSTOM', repeatCycle: 'DAILY', repeatEvery: 2 },
      notesWithRule: 'Balcony\n\nRepeats: every 2 days',
    });
  });

  it('keeps an unmappable recurrence as text in the notes', () => {
    const [t] = parseTasks([
      {
        id: 'T1',
        title: 'Pay rent',
        dueDateTime: { dateTime: '2026-12-01T00:00:00.0000000', timeZone: 'UTC' },
        recurrence: { pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: 28 } },
      },
    ]);
    expect(t.repeat).toBeNull();
    expect(t.notes).toBe('Repeats: every month on day 28');
  });

  it('reduces an HTML body to text', () => {
    const [t] = parseTasks([
      {
        id: 'T1',
        title: 'x',
        body: {
          content: '<p>Line <b>one</b></p><p>Line two<br>three</p>',
          contentType: 'html',
        },
      },
    ]);
    expect(t.notes).toBe('Line one\nLine two\nthree');
  });

  it('clamps over-long titles and counts the truncation', () => {
    const [t] = parseTasks([{ id: 'T1', title: 'a'.repeat(1001) }]);
    expect(t.title).toBe(`${'a'.repeat(1000)}…`);
    expect(t.truncatedFieldCount).toBe(1);
  });

  it('falls back to placeholder titles', () => {
    const model = parseGraphData({
      lists: [{ id: 'L1', displayName: '' }],
      tasksByListId: { L1: [{ id: 'T1', title: '' }] },
    });
    expect(model.projects[0].title).toBe('Untitled list');
    expect(model.tasks[0].title).toBe('Untitled task');
  });
});

describe('parseDueDay', () => {
  it('takes the day of a midnight value as-is', () => {
    expect(
      parseDueDay({ dateTime: '2026-12-03T00:00:00.0000000', timeZone: 'UTC' }),
    ).toBe('2026-12-03');
    expect(
      parseDueDay({
        dateTime: '2026-12-03T00:00:00.0000000',
        timeZone: 'W. Europe Standard Time',
      }),
    ).toBe('2026-12-03');
  });

  it('converts a non-midnight UTC value to the local day', () => {
    // jest runs in the system zone; compute the expectation from a literal instant
    const expected = new Date(Date.UTC(2026, 11, 2, 23, 0)).toLocaleDateString('sv-SE');
    expect(
      parseDueDay({ dateTime: '2026-12-02T23:00:00.0000000', timeZone: 'UTC' }),
    ).toBe(expected);
  });

  it('rejects missing and impossible dates', () => {
    expect(parseDueDay(null)).toBeNull();
    expect(parseDueDay({ dateTime: '2026-13-40T00:00:00', timeZone: 'UTC' })).toBeNull();
  });
});
