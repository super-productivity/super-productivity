import { TaskReminderOptionId } from './task.model';
import { AddTaskPayload } from './add-task-bar/add-task-payload-builder';
import { RepeatQuickSetting } from '../task-repeat-cfg/task-repeat-cfg.model';
import { TODAY_TAG } from '../tag/tag.const';

export interface QuickAddTaskPayloadValidationContext {
  projectIds: ReadonlySet<string>;
  tagIds: ReadonlySet<string>;
}

const MAX_TITLE_LENGTH = 1000;
const MAX_NEW_TAGS = 20;
const MAX_NEW_TAG_TITLE_LENGTH = 100;
const MAX_DURATION_MS = 366 * 24 * 60 * 60 * 1000;
const MIN_TIMESTAMP_MS = Date.UTC(2000, 0, 1);
const MAX_TIMESTAMP_MS = Date.UTC(2100, 0, 1);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const VALID_REMIND_OPTIONS = new Set<string>(Object.values(TaskReminderOptionId));
const VALID_REPEAT_SETTINGS = new Set<RepeatQuickSetting | null>([
  null,
  'DAILY',
  'WEEKLY_CURRENT_WEEKDAY',
  'MONTHLY_CURRENT_DATE',
  'MONTHLY_FIRST_DAY',
  'MONTHLY_LAST_DAY',
  'MONTHLY_NTH_WEEKDAY',
  'MONDAY_TO_FRIDAY',
  'YEARLY_CURRENT_DATE',
  'CUSTOM',
]);

export const validateQuickAddTaskPayload = (
  payload: AddTaskPayload,
  ctx: QuickAddTaskPayloadValidationContext,
): string | null => {
  if (!payload || typeof payload.title !== 'string' || !payload.title.trim()) {
    return 'Task title is empty';
  }
  if (payload.title.length > MAX_TITLE_LENGTH) {
    return 'Task title is too long';
  }
  if (
    !payload.taskData ||
    typeof payload.taskData !== 'object' ||
    Array.isArray(payload.taskData)
  ) {
    return 'Task data is invalid';
  }
  if (
    typeof payload.taskData.projectId !== 'string' ||
    !ctx.projectIds.has(payload.taskData.projectId)
  ) {
    return 'Project is invalid';
  }
  const tagValidationError = _validateTagIds(payload, ctx);
  if (tagValidationError) {
    return tagValidationError;
  }
  const newTagValidationError = _validateNewTags(payload.newTagTitles);
  if (newTagValidationError) {
    return newTagValidationError;
  }
  const dateValidationError = _validateDates(payload);
  if (dateValidationError) {
    return dateValidationError;
  }
  const durationValidationError = _validateDurations(payload);
  if (durationValidationError) {
    return durationValidationError;
  }
  if (!VALID_REMIND_OPTIONS.has(payload.remindOption)) {
    return 'Reminder is invalid';
  }
  if (!VALID_REPEAT_SETTINGS.has(payload.repeatQuickSetting)) {
    return 'Repeat setting is invalid';
  }
  const repeatTagIds = payload.repeatCfg?.tagIds;
  if (repeatTagIds !== undefined && !Array.isArray(repeatTagIds)) {
    return 'Tag is invalid';
  }
  if (repeatTagIds?.some((tagId) => tagId === TODAY_TAG.id || !ctx.tagIds.has(tagId))) {
    return 'Tag is invalid';
  }
  if (
    payload.repeatCfg?.startDate !== undefined &&
    (typeof payload.repeatCfg.startDate !== 'string' ||
      !_isValidDateStr(payload.repeatCfg.startDate))
  ) {
    return 'Date is invalid';
  }
  return null;
};

const _validateTagIds = (
  payload: AddTaskPayload,
  ctx: QuickAddTaskPayloadValidationContext,
): string | null => {
  const tagIds = payload.taskData.tagIds ?? [];
  if (!Array.isArray(tagIds)) {
    return 'Tag is invalid';
  }
  if (tagIds.some((tagId) => tagId === TODAY_TAG.id || !ctx.tagIds.has(tagId))) {
    return 'Tag is invalid';
  }
  return null;
};

const _validateNewTags = (newTagTitles?: string[]): string | null => {
  if (!newTagTitles) {
    return null;
  }
  if (!Array.isArray(newTagTitles)) {
    return 'New tags are invalid';
  }
  if (newTagTitles.length > MAX_NEW_TAGS) {
    return 'Too many new tags';
  }
  if (
    newTagTitles.some(
      (title) =>
        typeof title !== 'string' ||
        !title.trim() ||
        title.length > MAX_NEW_TAG_TITLE_LENGTH,
    )
  ) {
    return 'New tag title is invalid';
  }
  return null;
};

const _validateDates = (payload: AddTaskPayload): string | null => {
  const { dueDay, deadlineDay, dueWithTime, deadlineWithTime, deadlineRemindAt } =
    payload.taskData;
  if (
    (dueDay !== undefined &&
      dueDay !== null &&
      (typeof dueDay !== 'string' || !_isValidDateStr(dueDay))) ||
    (deadlineDay !== undefined &&
      deadlineDay !== null &&
      (typeof deadlineDay !== 'string' || !_isValidDateStr(deadlineDay)))
  ) {
    return 'Date is invalid';
  }
  if (
    !_isValidOptionalTimestamp(dueWithTime) ||
    !_isValidOptionalTimestamp(deadlineWithTime) ||
    !_isValidOptionalTimestamp(deadlineRemindAt)
  ) {
    return 'Timestamp is invalid';
  }
  return null;
};

const _validateDurations = (payload: AddTaskPayload): string | null => {
  const { timeEstimate } = payload.taskData;
  if (!_isValidOptionalDuration(timeEstimate)) {
    return 'Duration is invalid';
  }
  if (
    payload.taskData.timeSpentOnDay &&
    Object.values(payload.taskData.timeSpentOnDay).some(
      (value) => !_isValidOptionalDuration(value),
    )
  ) {
    return 'Duration is invalid';
  }
  if (!_isValidOptionalDuration(payload.repeatCfg?.defaultEstimate)) {
    return 'Duration is invalid';
  }
  return null;
};

const _isValidDateStr = (dateStr: string): boolean => {
  if (!DATE_RE.test(dateStr)) {
    return false;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const _isValidOptionalTimestamp = (
  value: number | null | undefined,
): value is number | null | undefined =>
  value === undefined ||
  value === null ||
  (Number.isFinite(value) && value >= MIN_TIMESTAMP_MS && value <= MAX_TIMESTAMP_MS);

const _isValidOptionalDuration = (
  value: number | null | undefined,
): value is number | null | undefined =>
  value === undefined ||
  value === null ||
  (Number.isFinite(value) && value >= 0 && value <= MAX_DURATION_MS);
