import { DateInputLocale } from '../../../core/date-time-format/date-input-locale';
import { DateService } from '../../../core/date/date.service';
import { ShortSyntaxConfig } from '../../config/global-config.model';
import { Task } from '../task.model';
import { shortSyntax } from '../short-syntax';
import {
  DeadlineAutoPlanContext,
  getDeadlineAutoPlanDecision,
} from './get-deadline-auto-plan-fields';

export type ShortSyntaxReminderPreview = {
  schedule?: 'day' | 'time';
  deadline?: { type: 'set'; fields: { deadlineDay?: string; deadlineWithTime?: number } };
};

/**
 * The create effect parses titles after dispatch. Preflight exactly its date
 * syntax when a REST caller supplied a reminder, so an async day-only plan
 * cannot leave a reminder without a scheduled time.
 */
export const previewReminderShortSyntax = async (
  title: string,
  isIgnoreShortSyntax: boolean,
  config: ShortSyntaxConfig,
  locale: DateInputLocale,
): Promise<ShortSyntaxReminderPreview> => {
  if (isIgnoreShortSyntax || (!title.includes('@') && !title.includes('!'))) {
    return {};
  }
  const parsed = await shortSyntax(
    { title },
    config,
    undefined,
    undefined,
    undefined,
    'combine',
    false,
    locale,
  );
  const changes = parsed?.taskChanges;
  const schedule = changes?.dueWithTime
    ? changes.hasPlannedTime === false
      ? ('day' as const)
      : ('time' as const)
    : undefined;
  const deadline: ShortSyntaxReminderPreview['deadline'] =
    typeof changes?.deadlineWithTime === 'number'
      ? { type: 'set', fields: { deadlineWithTime: changes.deadlineWithTime } }
      : typeof changes?.deadlineDay === 'string'
        ? { type: 'set', fields: { deadlineDay: changes.deadlineDay } }
        : undefined;
  return { schedule, deadline };
};

/**
 * Use the deadline reducer's decision for the task's projected effective
 * fields. A newly set deadline type replaces the old one before auto-planning.
 */
export const deadlineWouldClearReminderTime = (
  task: Task,
  change:
    | { type: string; fields?: { deadlineDay?: string; deadlineWithTime?: number } }
    | undefined,
  context: DeadlineAutoPlanContext,
  todayTaskIds: ReadonlySet<string>,
  parent?: Task,
): boolean =>
  change?.type === 'set' &&
  getDeadlineAutoPlanDecision(
    {
      ...task,
      deadlineDay: undefined,
      deadlineWithTime: undefined,
      ...change.fields,
    },
    context,
    todayTaskIds,
    parent,
  ).shouldClearDueWithTime;

/** Returns the HTTP 400 reason before a REST call changes task state. */
export const getExplicitReminderConflict = async ({
  task,
  deadline,
  title,
  isIgnoreShortSyntax = false,
  config,
  locale,
  dateService,
  getParent,
  getTodayTaskIds,
}: {
  task: Task;
  deadline?: {
    type: string;
    fields?: { deadlineDay?: string; deadlineWithTime?: number };
  };
  title?: string;
  isIgnoreShortSyntax?: boolean;
  config?: ShortSyntaxConfig;
  locale?: DateInputLocale;
  dateService: Pick<DateService, 'todayStr' | 'getStartOfNextDayDiffMs'>;
  getParent: (parentId: string) => Promise<Task | undefined>;
  getTodayTaskIds: () => Promise<string[]>;
}): Promise<string | undefined> => {
  const preview =
    title !== undefined && config && locale
      ? await previewReminderShortSyntax(title, isIgnoreShortSyntax, config, locale)
      : undefined;
  if (preview?.schedule === 'day') {
    return 'remindAt conflicts with a day-only short-syntax schedule';
  }
  // A timed parsed schedule replaces the old dueWithTime after the deadline
  // reducer runs. The explicit reminder is preserved by ShortSyntaxEffects.
  if (preview?.schedule === 'time') return undefined;
  if (deadline?.type !== 'set' && !preview?.deadline) return undefined;

  const parent = task.parentId ? await getParent(task.parentId) : undefined;
  const todayTaskIds = task.parentId
    ? new Set(await getTodayTaskIds())
    : new Set<string>();
  const context = {
    today: dateService.todayStr(),
    startOfNextDayDiffMs: dateService.getStartOfNextDayDiffMs(),
  };
  return deadlineWouldClearReminderTime(task, deadline, context, todayTaskIds, parent) ||
    deadlineWouldClearReminderTime(task, preview?.deadline, context, todayTaskIds, parent)
    ? 'remindAt conflicts with deadline auto-planning that clears dueWithTime'
    : undefined;
};
