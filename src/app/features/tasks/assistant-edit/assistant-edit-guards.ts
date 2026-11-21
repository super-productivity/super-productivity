import { AssistantEditRejection } from '../../../../../electron/shared-with-frontend/assistant-access.model';
import {
  IssueProvider,
  IssueProviderPluginType,
  isPluginIssueProvider,
} from '../../issue/issue.model';
import { TODAY_TAG } from '../../tag/tag.const';
import { Task } from '../task.model';
import { AssistantTaskUpdate } from './assistant-edit-input';

/**
 * What an assistant edit may not do, decided before anything is dispatched.
 *
 * The guards keep assistant edits inside the user's own task list. An edit of
 * a task linked to an issue reaches the issue: two-way sync pushes isDone,
 * title, dates, estimates and tags, and Jira or OpenProject transitions run on
 * completion and on starting to track. A timed task can have a calendar
 * time-block, and tracked sessions can be logged to a calendar. Such edits are
 * refused rather than declared open-world, so a steered assistant cannot copy
 * what it read into an outside service.
 */

/** A task linked to an issue, or a subtask of one (completing it can complete the parent). */
const isInIssueTree = (task: Task, parent: Task | undefined): boolean =>
  !!(task.issueId || task.issueType || parent?.issueId || parent?.issueType);

const isPluginOptionOn = (providers: IssueProvider[], option: string): boolean =>
  providers.some(
    (p) =>
      isPluginIssueProvider(p.issueProviderKey) &&
      !!(p as IssueProviderPluginType).pluginConfig?.[option],
  );

/** Calendar time-blocks are written for timed tasks (time-block-sync.effects.ts). */
export const isAutoTimeBlockOn = (providers: IssueProvider[]): boolean =>
  isPluginOptionOn(providers, 'isAutoTimeBlock');

/** Tracked sessions are written to a calendar (work-session-log.effects.ts). */
export const isWorkSessionLogOn = (providers: IssueProvider[]): boolean =>
  isPluginOptionOn(providers, 'isLogWorkSessions');

export interface AssistantUpdateContext {
  task: Task;
  parent?: Task;
  knownTagIds: ReadonlySet<string>;
  isAutoTimeBlockOn: boolean;
}

export const getUpdateRejection = (
  update: AssistantTaskUpdate,
  { task, parent, knownTagIds, isAutoTimeBlockOn: isTimeBlockOn }: AssistantUpdateContext,
): AssistantEditRejection | undefined => {
  if (isInIssueTree(task, parent)) {
    return 'ISSUE_LINKED_TASK';
  }
  // The time-block follows the schedule, title, estimate and done state.
  const touchesTimeBlock =
    update.due !== undefined ||
    update.title !== undefined ||
    update.estimateMinutes !== undefined ||
    update.isDone !== undefined;
  if (isTimeBlockOn && touchesTimeBlock && (task.dueWithTime || update.due?.time)) {
    return 'CALENDAR_LINKED_TASK';
  }
  // A recurring task's day comes from its recurring settings; moving one
  // instance is not what "reschedule my daily review" means.
  if (task.repeatCfgId && update.due !== undefined) {
    return 'RECURRING_TASK_SCHEDULE';
  }
  // A parent's estimate is recomputed from its subtasks.
  if (update.estimateMinutes !== undefined && task.subTaskIds.length) {
    return 'PARENT_TASK_ESTIMATE';
  }
  // TODAY is virtual: membership comes from the due date (Decision #2).
  if (update.tagIds?.some((id) => id === TODAY_TAG.id || !knownTagIds.has(id))) {
    return 'TAG_NOT_FOUND';
  }
  return undefined;
};

export interface AssistantStartContext {
  task: Task;
  parent?: Task;
  isTimeTrackingEnabled: boolean;
  isWorkSessionLogOn: boolean;
}

/** Starting is refused where the play button is hidden, and where it reaches outside. */
export const getStartRejection = ({
  task,
  parent,
  isTimeTrackingEnabled,
  isWorkSessionLogOn: isSessionLogOn,
}: AssistantStartContext): AssistantEditRejection | undefined => {
  if (!isTimeTrackingEnabled) {
    return 'TIME_TRACKING_DISABLED';
  }
  if (task.isDone || task.subTaskIds.length) {
    return 'CANNOT_TRACK_TASK';
  }
  if (isInIssueTree(task, parent)) {
    return 'ISSUE_LINKED_TASK';
  }
  if (isSessionLogOn) {
    return 'CALENDAR_LINKED_TASK';
  }
  return undefined;
};
