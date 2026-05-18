import type { DateService } from '../../../core/date/date.service';
import { DEFAULT_TASK, Task } from '../task.model';
import {
  getDeadlineAutoPlanDecision,
  getDeadlineAutoPlanFields,
} from './get-deadline-auto-plan-fields';

describe('getDeadlineAutoPlanFields', () => {
  let dateService: jasmine.SpyObj<
    Pick<DateService, 'todayStr' | 'getStartOfNextDayDiffMs'>
  >;

  beforeEach(() => {
    dateService = jasmine.createSpyObj('DateService', [
      'todayStr',
      'getStartOfNextDayDiffMs',
    ]);
    dateService.todayStr.and.returnValue('2026-01-05');
    dateService.getStartOfNextDayDiffMs.and.returnValue(123);
  });

  it('should include auto-plan context for a whole-day deadline today', () => {
    expect(getDeadlineAutoPlanFields(dateService, '2026-01-05')).toEqual({
      autoPlanToday: '2026-01-05',
      autoPlanStartOfNextDayDiffMs: 123,
    });
  });

  it('should include auto-plan context for a timed deadline today', () => {
    dateService.getStartOfNextDayDiffMs.and.returnValue(0);
    const deadlineWithTime = new Date(2026, 0, 5, 12).getTime();

    expect(getDeadlineAutoPlanFields(dateService, undefined, deadlineWithTime)).toEqual({
      autoPlanToday: '2026-01-05',
      autoPlanStartOfNextDayDiffMs: 0,
    });
  });

  it('should return no auto-plan context for future deadlines', () => {
    dateService.getStartOfNextDayDiffMs.and.returnValue(0);
    const deadlineWithTime = new Date(2026, 0, 6, 12).getTime();

    expect(getDeadlineAutoPlanFields(dateService, '2026-01-06')).toEqual({});
    expect(getDeadlineAutoPlanFields(dateService, undefined, deadlineWithTime)).toEqual(
      {},
    );
  });

  it('should let deadlineWithTime take precedence over stale deadlineDay', () => {
    dateService.getStartOfNextDayDiffMs.and.returnValue(0);
    const futureDeadlineWithTime = new Date(2026, 0, 6, 12).getTime();

    expect(
      getDeadlineAutoPlanFields(dateService, '2026-01-05', futureDeadlineWithTime),
    ).toEqual({});
  });
});

describe('getDeadlineAutoPlanDecision', () => {
  const context = {
    today: '2026-01-05',
    startOfNextDayDiffMs: 0,
  };

  const createTask = (overrides: Partial<Task> = {}): Task =>
    ({
      ...DEFAULT_TASK,
      id: 'task1',
      title: 'Task 1',
      projectId: 'project1',
      created: new Date(2026, 0, 1, 12).getTime(),
      deadlineDay: context.today,
      ...overrides,
    }) as Task;

  it('should set dueDay for an unscheduled task with a deadline today', () => {
    expect(getDeadlineAutoPlanDecision(createTask(), context, new Set<string>())).toEqual(
      {
        shouldAutoPlan: true,
        shouldUpdateDueDay: true,
        shouldClearDueWithTime: false,
        shouldClearRemindAt: false,
      },
    );
  });

  it('should only add Today ordering when the task is already due today', () => {
    expect(
      getDeadlineAutoPlanDecision(
        createTask({ dueWithTime: new Date(2026, 0, 5, 12).getTime() }),
        context,
        new Set<string>(),
      ),
    ).toEqual({
      shouldAutoPlan: true,
      shouldUpdateDueDay: false,
      shouldClearDueWithTime: false,
      shouldClearRemindAt: false,
    });
  });

  it('should move overdue timed tasks to dueDay today and clear dueWithTime + remindAt', () => {
    expect(
      getDeadlineAutoPlanDecision(
        createTask({ dueWithTime: new Date(2026, 0, 4, 12).getTime() }),
        context,
        new Set<string>(),
      ),
    ).toEqual({
      shouldAutoPlan: true,
      shouldUpdateDueDay: true,
      shouldClearDueWithTime: true,
      shouldClearRemindAt: true,
    });
  });

  it('should skip future-scheduled tasks', () => {
    expect(
      getDeadlineAutoPlanDecision(
        createTask({ dueWithTime: new Date(2026, 0, 6, 12).getTime() }),
        context,
        new Set<string>(),
      ),
    ).toEqual({
      shouldAutoPlan: false,
      shouldUpdateDueDay: false,
      shouldClearDueWithTime: false,
      shouldClearRemindAt: false,
    });
  });

  it('should skip subtasks whose parent is due today', () => {
    const parentTask = createTask({
      id: 'parent',
      deadlineDay: undefined,
      dueDay: context.today,
    });
    const subTask = createTask({ id: 'sub', parentId: 'parent' });

    expect(
      getDeadlineAutoPlanDecision(subTask, context, new Set<string>(), parentTask),
    ).toEqual({
      shouldAutoPlan: false,
      shouldUpdateDueDay: false,
      shouldClearDueWithTime: false,
      shouldClearRemindAt: false,
    });
  });
});
