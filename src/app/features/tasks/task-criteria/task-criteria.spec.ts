import { TaskCopy } from '../task.model';
import {
  buildTaskComparator,
  createTaskCriteriaCtx,
  getChangesToMatch,
  getTagIdsToMatch,
  isCriteriaUnreachableForNewTasks,
  matchesTaskCriteria,
} from './task-criteria';
import {
  TASK_DATE_RULES,
  TaskCriteria,
  TaskCriteriaCtx,
  TaskMatchChanges,
} from './task-criteria.model';

// Friday 2026-10-30; weeks start on Monday unless a test says otherwise.
const TODAY = '2026-10-30';
const YESTERDAY = '2026-10-29';
const HOUR = 60 * 60 * 1000;
const ctxFor = (
  opts: Partial<Parameters<typeof createTaskCriteriaCtx>[0]> = {},
): TaskCriteriaCtx =>
  createTaskCriteriaCtx({
    todayStr: TODAY,
    startOfNextDayDiffMs: 0,
    firstDayOfWeek: 1,
    ...opts,
  });
const CTX = ctxFor();

const mkTask = (partial: Partial<TaskCopy> = {}): TaskCopy =>
  ({
    id: 't',
    title: 'Task',
    projectId: 'p1',
    tagIds: [],
    subTaskIds: [],
    isDone: false,
    timeEstimate: 0,
    timeSpent: 0,
    timeSpentOnDay: {},
    created: 0,
    ...partial,
  }) as TaskCopy;

const at = (day: string, hours: number): number => {
  const date = new Date(`${day}T00:00:00`);
  date.setHours(hours);
  return date.getTime();
};

const matches = (
  task: Partial<TaskCopy>,
  criteria: TaskCriteria,
  ctx: TaskCriteriaCtx = CTX,
): boolean => matchesTaskCriteria(mkTask(task), criteria, ctx);

describe('createTaskCriteriaCtx', () => {
  it('derives week, month and 7-day bounds from the logical day', () => {
    expect(CTX).toEqual(
      jasmine.objectContaining({
        tomorrowStr: '2026-10-31',
        next7DaysEndStr: '2026-11-05',
        weekStartStr: '2026-10-26',
        weekEndStr: '2026-11-01',
        nextWeekStartStr: '2026-11-02',
        nextWeekEndStr: '2026-11-08',
        monthEndStr: '2026-10-31',
        nextMonthStartStr: '2026-11-01',
        nextMonthEndStr: '2026-11-30',
      }),
    );
  });

  it('starts weeks on the configured day', () => {
    const sundayWeeks = ctxFor({ firstDayOfWeek: 0 });
    expect(sundayWeeks.weekStartStr).toBe('2026-10-25');
    expect(sundayWeeks.weekEndStr).toBe('2026-10-31');
  });

  it('rolls months over the year end', () => {
    const december = ctxFor({ todayStr: '2026-12-15' });
    expect(december.nextMonthStartStr).toBe('2027-01-01');
    expect(december.nextMonthEndStr).toBe('2027-01-31');
  });
});

describe('matchesTaskCriteria', () => {
  it('matches everything without criteria and nothing with isNoMatch', () => {
    expect(matches({}, {})).toBeTrue();
    expect(matches({}, { isNoMatch: true })).toBeFalse();
  });

  describe('date rules (planned date)', () => {
    const cases: [string, Partial<TaskCopy>, boolean][] = [
      ['overdue', { dueDay: '2026-10-29' }, true],
      ['overdue', { dueDay: TODAY }, false],
      ['todayOrOverdue', { dueDay: '2026-10-01' }, true],
      ['todayOrOverdue', { dueWithTime: at(TODAY, 18) }, true],
      ['todayOrOverdue', { dueDay: '2026-10-31' }, false],
      ['today', { dueDay: TODAY }, true],
      ['tomorrow', { dueDay: '2026-10-31' }, true],
      ['next7Days', { dueDay: '2026-11-05' }, true],
      ['next7Days', { dueDay: '2026-11-06' }, false],
      ['thisWeek', { dueDay: '2026-10-26' }, true],
      ['thisWeek', { dueDay: '2026-11-02' }, false],
      ['nextWeek', { dueDay: '2026-11-08' }, true],
      ['thisMonth', { dueDay: '2026-10-01' }, true],
      ['thisMonth', { dueDay: '2026-11-01' }, false],
      ['nextMonth', { dueDay: '2026-11-30' }, true],
      ['none', {}, true],
      ['none', { dueDay: TODAY }, false],
    ];
    cases.forEach(([rule, task, expected]) => {
      it(`${rule} ${JSON.stringify(task)} → ${expected}`, () => {
        expect(matches(task, { plannedDate: rule as never })).toBe(expected);
      });
    });

    it('never matches an undated task with a date rule other than none', () => {
      TASK_DATE_RULES.filter((rule) => rule !== 'none').forEach((rule) =>
        expect(matches({}, { plannedDate: rule }))
          .withContext(rule)
          .toBeFalse(),
      );
    });

    it('uses the start of next day for timestamps', () => {
      // Day starts at 04:00: 02:00 on Oct 31 still belongs to Oct 30.
      const ctx = ctxFor({ startOfNextDayDiffMs: 4 * HOUR });
      expect(
        matches({ dueWithTime: at('2026-10-31', 2) }, { plannedDate: 'today' }, ctx),
      ).toBeTrue();
    });

    it('reads dueWithTime first unless the ctx says otherwise', () => {
      const task = { dueDay: '2026-10-31', dueWithTime: at(TODAY, 9) };
      expect(matches(task, { plannedDate: 'today' })).toBeTrue();
      expect(
        matches(task, { plannedDate: 'today' }, ctxFor({ isDayBeforeTime: true })),
      ).toBeFalse();
    });
  });

  it('applies the same date rules to the deadline', () => {
    expect(matches({ deadlineDay: '2026-11-01' }, { deadline: 'thisWeek' })).toBeTrue();
    expect(
      matches({ deadlineWithTime: at('2026-10-29', 9) }, { deadline: 'overdue' }),
    ).toBeTrue();
    expect(matches({}, { deadline: 'none' })).toBeTrue();
  });

  it('tags: all/any include, any/all exclude, untagged', () => {
    expect(matches({ tagIds: ['a'] }, { includedTagIds: ['a', 'b'] })).toBeFalse();
    expect(
      matches(
        { tagIds: ['a'] },
        { includedTagIds: ['a', 'b'], includedTagsMatch: 'any' },
      ),
    ).toBeTrue();
    expect(matches({ tagIds: ['x'] }, { excludedTagIds: ['x', 'y'] })).toBeFalse();
    expect(
      matches(
        { tagIds: ['x'] },
        { excludedTagIds: ['x', 'y'], excludedTagsMatch: 'all' },
      ),
    ).toBeTrue();
    expect(matches({ tagIds: [] }, { isUntagged: true })).toBeTrue();
    expect(matches({ tagIds: ['a'] }, { isUntagged: true })).toBeFalse();
  });

  it('projects, done, parent only, scheduled and backlog', () => {
    expect(matches({ projectId: 'p2' }, { projectIds: ['p1'] })).toBeFalse();
    expect(matches({ isDone: true }, { done: 'undone' })).toBeFalse();
    expect(matches({ parentId: 'p' }, { isParentOnly: true })).toBeFalse();
    expect(matches({}, { scheduled: 'scheduled' })).toBeFalse();
    expect(matches({ dueDay: TODAY }, { scheduled: 'unscheduled' })).toBeFalse();
    const backlogCtx = ctxFor({ isInBacklog: () => true });
    expect(matches({}, { backlog: 'only' }, backlogCtx)).toBeTrue();
    expect(matches({}, { backlog: 'exclude' }, backlogCtx)).toBeFalse();
  });

  it('estimate and time spent: none or a minimum', () => {
    expect(matches({ timeEstimate: 0 }, { estimate: 'none' })).toBeTrue();
    expect(matches({ timeEstimate: 30 * 60000 }, { estimate: 30 * 60000 })).toBeTrue();
    expect(matches({ timeEstimate: 10 * 60000 }, { estimate: 30 * 60000 })).toBeFalse();
    // "none" reads the total, a minimum sums the days (like the filter menu).
    expect(matches({ timeSpent: 0 }, { timeSpent: 'none' })).toBeTrue();
    expect(
      matches(
        { timeSpentOnDay: { [YESTERDAY]: 20 * 60000, [TODAY]: 15 * 60000 } },
        { timeSpent: 30 * 60000 },
      ),
    ).toBeTrue();
  });

  it('priority: none or a level, legacy string values included', () => {
    expect(matches({}, { priority: 'none' })).toBeTrue();
    expect(matches({ priority: 3 }, { priority: 3 })).toBeTrue();
    expect(matches({ priority: 'high' as never }, { priority: 3 })).toBeTrue();
    expect(matches({ priority: 1 }, { priority: 'none' })).toBeFalse();
  });
});

describe('getTagIdsToMatch', () => {
  it('adds required and strips excluded tags, never adding TODAY', () => {
    expect(
      getTagIdsToMatch(['TODAY', 'x', 'keep'], {
        includedTagIds: ['a'],
        excludedTagIds: ['x'],
      }),
    ).toEqual(['keep', 'a']);
    expect(getTagIdsToMatch(['a'], { isUntagged: true })).toEqual([]);
  });
});

describe('getChangesToMatch', () => {
  const changesFor = (
    task: Partial<TaskCopy>,
    criteria: TaskCriteria,
    ctx: TaskCriteriaCtx = CTX,
  ): TaskMatchChanges | null => getChangesToMatch(mkTask(task), criteria, ctx);

  it('needs no change for a matching task', () => {
    expect(changesFor({ dueDay: TODAY }, { plannedDate: 'today' })).toEqual({});
  });

  it('plans for the day a planned-date rule needs', () => {
    expect(changesFor({}, { plannedDate: 'today' })?.scheduleDay).toBe(TODAY);
    expect(changesFor({}, { plannedDate: 'tomorrow' })?.scheduleDay).toBe('2026-10-31');
    expect(changesFor({}, { plannedDate: 'nextWeek' })?.scheduleDay).toBe('2026-11-02');
    expect(changesFor({}, { plannedDate: 'nextMonth' })?.scheduleDay).toBe('2026-11-01');
    expect(
      changesFor({ dueDay: TODAY }, { plannedDate: 'none' })?.isUnschedule,
    ).toBeTrue();
  });

  it('sets a range deadline to its last day and today only for today rules', () => {
    expect(changesFor({}, { deadline: 'thisWeek' })?.deadlineDay).toBe('2026-11-01');
    expect(changesFor({}, { deadline: 'nextMonth' })?.deadlineDay).toBe('2026-11-30');
    expect(changesFor({}, { deadline: 'today' })?.deadlineDay).toBe(TODAY);
    expect(
      changesFor({ deadlineDay: TODAY }, { deadline: 'none' })?.isRemoveDeadline,
    ).toBeTrue();
  });

  it('refuses what no change can satisfy', () => {
    expect(changesFor({}, { plannedDate: 'overdue' })).toBeNull();
    expect(changesFor({}, { deadline: 'overdue' })).toBeNull();
    expect(changesFor({ timeEstimate: 0 }, { estimate: 60000 })).toBeNull();
    expect(changesFor({}, { timeSpent: 60000 })).toBeNull();
    expect(changesFor({ parentId: 'p' }, { isParentOnly: true })).toBeNull();
    expect(changesFor({}, { isNoMatch: true })).toBeNull();
  });

  it('refuses rules the deadline auto-plan into Today breaks', () => {
    // A deadline of today plans an unplanned task for today, so it can't
    // stay unscheduled or be planned for tomorrow.
    expect(changesFor({}, { deadline: 'today', scheduled: 'unscheduled' })).toBeNull();
    expect(changesFor({}, { deadline: 'today', plannedDate: 'overdue' })).toBeNull();
    // ...but it leaves a task planned for a later day alone.
    expect(changesFor({}, { deadline: 'today', plannedDate: 'tomorrow' })).toEqual({
      scheduleDay: '2026-10-31',
      deadlineDay: TODAY,
    });
    // A done task isn't auto-planned.
    expect(
      changesFor({ isDone: true }, { deadline: 'today', scheduled: 'unscheduled' }),
    ).not.toBeNull();
  });

  it('moves into a backlog only where the project has one', () => {
    expect(changesFor({}, { backlog: 'only' })).toBeNull();
    expect(
      changesFor({}, { backlog: 'only' }, ctxFor({ isBacklogEnabled: () => true }))
        ?.backlog,
    ).toBe('moveIn');
    expect(
      changesFor({}, { backlog: 'exclude' }, ctxFor({ isInBacklog: () => true }))
        ?.backlog,
    ).toBe('moveOut');
  });

  it('sets priority, done state, project and tags', () => {
    expect(
      changesFor(
        { priority: 3, isDone: true, projectId: 'p2', tagIds: ['x'] },
        {
          priority: 'none',
          done: 'undone',
          projectIds: ['p1'],
          includedTagIds: ['a'],
          excludedTagIds: ['x'],
        },
      ),
    ).toEqual({ priority: null, isDone: false, projectId: 'p1', tagIds: ['a'] });
  });

  it('asks for a date when a rule only needs "scheduled"', () => {
    expect(changesFor({}, { scheduled: 'scheduled' })?.isAskForSchedule).toBeTrue();
  });

  // Property: applying the changes (the way the actions do) makes any task match.
  describe('applying the changes makes the task match', () => {
    const tasks: Partial<TaskCopy>[] = [
      {},
      { dueDay: '2026-10-20', deadlineDay: '2026-10-29' },
      { dueWithTime: at('2026-11-12', 9), tagIds: ['x', 'b'], priority: 2 },
      { isDone: true, projectId: 'p2', deadlineWithTime: at('2026-12-01', 9) },
    ];
    const criteriaList: TaskCriteria[] = [
      ...TASK_DATE_RULES.map((rule): TaskCriteria => ({ plannedDate: rule })),
      ...TASK_DATE_RULES.map((rule): TaskCriteria => ({ deadline: rule })),
      { deadline: 'today', done: 'undone' },
      { deadline: 'thisWeek', plannedDate: 'nextWeek' },
      { includedTagIds: ['a'], excludedTagIds: ['b'], priority: 1, done: 'done' },
      { isUntagged: true, projectIds: ['p1'], scheduled: 'unscheduled' },
    ];
    const apply = (task: TaskCopy, changes: TaskMatchChanges): TaskCopy => {
      const next: TaskCopy = {
        ...task,
        projectId: changes.projectId ?? task.projectId,
        tagIds: changes.tagIds ?? task.tagIds,
        isDone: changes.isDone ?? task.isDone,
        priority:
          changes.priority === undefined
            ? task.priority
            : (changes.priority ?? undefined),
      };
      if (changes.isUnschedule)
        Object.assign(next, { dueDay: undefined, dueWithTime: undefined });
      if (changes.scheduleDay)
        Object.assign(next, { dueDay: changes.scheduleDay, dueWithTime: undefined });
      if (changes.isRemoveDeadline) {
        Object.assign(next, { deadlineDay: undefined, deadlineWithTime: undefined });
      }
      if (changes.deadlineDay) {
        Object.assign(next, {
          deadlineDay: changes.deadlineDay,
          deadlineWithTime: undefined,
        });
      }
      return next;
    };
    tasks.forEach((task, ti) =>
      criteriaList.forEach((criteria, ci) => {
        it(`task ${ti} × criteria ${ci}`, () => {
          const changes = getChangesToMatch(mkTask(task), criteria, CTX);
          if (changes) {
            expect(
              matchesTaskCriteria(apply(mkTask(task), changes), criteria, CTX),
            ).toBeTrue();
          }
        });
      }),
    );
  });
});

describe('isCriteriaUnreachableForNewTasks', () => {
  it('is true only for rules a new task can never meet', () => {
    expect(isCriteriaUnreachableForNewTasks({ plannedDate: 'overdue' })).toBeTrue();
    expect(isCriteriaUnreachableForNewTasks({ estimate: 60000 })).toBeTrue();
    expect(isCriteriaUnreachableForNewTasks({ estimate: 'none' })).toBeFalse();
    expect(isCriteriaUnreachableForNewTasks({ plannedDate: 'today' })).toBeFalse();
  });
});

describe('buildTaskComparator', () => {
  const sortCtx = {
    collator: new Intl.Collator('en', { sensitivity: 'base', numeric: true }),
  };
  const ids = (tasks: TaskCopy[]): string[] => tasks.map((task) => task.id);

  it('sorts titles naturally', () => {
    const tasks = ['Task 10', 'task 2', 'Task 1'].map((title, i) =>
      mkTask({ id: title, title, created: i }),
    );
    expect(ids(tasks.sort(buildTaskComparator('title', sortCtx)))).toEqual([
      'Task 1',
      'task 2',
      'Task 10',
    ]);
  });

  it('puts a date-only value at the end of its day and undated tasks last (#9828)', () => {
    const tasks = [
      mkTask({ id: 'none' }),
      mkTask({ id: 'day', dueDay: TODAY }),
      mkTask({ id: 'morning', dueWithTime: at(TODAY, 9) }),
    ];
    expect(ids(tasks.sort(buildTaskComparator('plannedDate', sortCtx)))).toEqual([
      'morning',
      'day',
      'none',
    ]);
  });

  it('lists high priority first ascending', () => {
    const tasks = [
      mkTask({ id: 'low', priority: 1 }),
      mkTask({ id: 'high', priority: 3 }),
    ];
    expect(ids(tasks.sort(buildTaskComparator('priority', sortCtx)))).toEqual([
      'high',
      'low',
    ]);
  });

  it('orders by the first tag in side-menu order, untagged last', () => {
    const tasks = [
      mkTask({ id: 'none' }),
      mkTask({ id: 'b', tagIds: ['b'] }),
      mkTask({ id: 'a', tagIds: ['x', 'a'] }),
    ];
    const cmp = buildTaskComparator('tag', {
      ...sortCtx,
      tagRankById: new Map([
        ['a', 0],
        ['b', 1],
      ]),
    });
    expect(ids(tasks.sort(cmp))).toEqual(['a', 'b', 'none']);
  });
});
