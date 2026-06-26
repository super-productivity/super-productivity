import { TaskCopy, TaskReminderOptionId } from '../task.model';
import { TaskAttachment } from '../task-attachment/task-attachment.model';
import {
  RepeatQuickSetting,
  TaskRepeatCfgCopy,
} from '../../task-repeat-cfg/task-repeat-cfg.model';
import { AddTaskBarState } from './add-task-bar.const';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { isValidSplitTime } from '../../../util/is-valid-split-time';
import { remindOptionToMilliseconds } from '../util/remind-option-to-milliseconds';
import { unique } from '../../../util/unique';
import { getQuickSettingUpdates } from '../../task-repeat-cfg/dialog-edit-task-repeat-cfg/get-quick-setting-updates';

type RepeatPresetQuickSetting = Exclude<RepeatQuickSetting, 'CUSTOM'>;

export interface AddTaskPayload {
  title: string;
  taskData: Partial<TaskCopy>;
  isAddToBacklog: boolean;
  isAddToBottom: boolean;
  remindOption: TaskReminderOptionId;
  repeatQuickSetting: RepeatQuickSetting | null;
  repeatCfg?: Partial<TaskRepeatCfgCopy>;
  newTagTitles?: string[];
}

export type AddTaskSubmitResult =
  | {
      ok: true;
      taskId: string;
    }
  | {
      ok: false;
      error: string;
    };

export interface BuildAddTaskPayloadParams {
  title: string;
  state: AddTaskBarState;
  note: string;
  isAddToBacklog: boolean;
  isAddToBottom: boolean;
  todayStr: string;
  defaultRemindOption: TaskReminderOptionId;
  finalTagIds?: string[];
  additionalFields?: Partial<TaskCopy>;
  newTagTitles?: string[];
}

export const buildAddTaskPayload = ({
  title,
  state,
  note,
  isAddToBacklog,
  isAddToBottom,
  todayStr,
  defaultRemindOption,
  finalTagIds = unique([...state.tagIds, ...state.tagIdsFromTxt]),
  additionalFields,
  newTagTitles,
}: BuildAddTaskPayloadParams): AddTaskPayload => {
  const taskData: Partial<TaskCopy> = {
    ...additionalFields,
    projectId: state.projectId,
    tagIds: additionalFields?.tagIds
      ? unique([...finalTagIds, ...additionalFields.tagIds])
      : finalTagIds,
    timeEstimate: state.estimate || 0,
    attachments: _getAttachments(state.attachments, additionalFields),
  };

  if (note) {
    taskData.notes = note;
  }
  if (state.spent) {
    taskData.timeSpentOnDay = state.spent;
  }
  if (state.deadlineDate) {
    _applyDeadline(taskData, state);
  }
  _applyDueDate(taskData, state, todayStr);

  const repeatCfg =
    state.repeatQuickSetting && state.repeatQuickSetting !== 'CUSTOM'
      ? _buildRepeatCfg(
          title,
          taskData.tagIds ?? [],
          state,
          todayStr,
          defaultRemindOption,
        )
      : undefined;

  return {
    title,
    taskData,
    isAddToBacklog,
    isAddToBottom,
    remindOption: state.remindOption ?? defaultRemindOption,
    repeatQuickSetting: state.repeatQuickSetting,
    repeatCfg,
    newTagTitles,
  };
};

const _getAttachments = (
  stateAttachments: TaskAttachment[],
  additionalFields?: Partial<TaskCopy>,
): TaskAttachment[] =>
  stateAttachments.length > 0 ? stateAttachments : additionalFields?.attachments || [];

const _applyDeadline = (taskData: Partial<TaskCopy>, state: AddTaskBarState): void => {
  if (!state.deadlineDate) {
    return;
  }
  if (state.deadlineTime && isValidSplitTime(state.deadlineTime)) {
    const deadlineTimestamp = getDateTimeFromClockString(
      state.deadlineTime,
      dateStrToUtcDate(state.deadlineDate),
    );
    taskData.deadlineWithTime = deadlineTimestamp;
    if (
      state.deadlineRemindOption &&
      state.deadlineRemindOption !== TaskReminderOptionId.DoNotRemind
    ) {
      taskData.deadlineRemindAt = remindOptionToMilliseconds(
        deadlineTimestamp,
        state.deadlineRemindOption,
      );
    }
  } else {
    taskData.deadlineDay = state.deadlineDate;
  }
};

const _applyDueDate = (
  taskData: Partial<TaskCopy>,
  state: AddTaskBarState,
  todayStr: string,
): void => {
  if (state.date) {
    const [year, month, day] = state.date.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    if (state.time) {
      const [hours, minutes] = state.time.split(':').map(Number);
      date.setHours(hours, minutes, 0, 0);
      taskData.dueWithTime = date.getTime();
      taskData.hasPlannedTime = true;
    } else {
      taskData.dueDay = state.date;
    }
  } else if (state.repeatQuickSetting && state.repeatQuickSetting !== 'CUSTOM') {
    taskData.dueDay = todayStr;
  } else {
    taskData.dueDay = undefined;
  }
};

const _buildRepeatCfg = (
  title: string,
  tagIds: string[],
  state: AddTaskBarState,
  todayStr: string,
  remindOption: TaskReminderOptionId,
): Partial<TaskRepeatCfgCopy> => {
  if (!_isRepeatPresetQuickSetting(state.repeatQuickSetting)) {
    return {};
  }
  const startDate = state.date || todayStr;
  const quickSetting = state.repeatQuickSetting;
  return {
    startDate,
    ...(getQuickSettingUpdates(quickSetting, dateStrToUtcDate(startDate)) || {}),
    title,
    quickSetting,
    tagIds,
    defaultEstimate: state.estimate || 0,
    startTime: state.time || undefined,
    remindAt: state.time ? remindOption : undefined,
  };
};

const _isRepeatPresetQuickSetting = (
  repeatQuickSetting: RepeatQuickSetting | null,
): repeatQuickSetting is RepeatPresetQuickSetting =>
  repeatQuickSetting !== null && repeatQuickSetting !== 'CUSTOM';
