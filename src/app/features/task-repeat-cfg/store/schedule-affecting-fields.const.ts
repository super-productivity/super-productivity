import { TaskRepeatCfgCopy } from '../task-repeat-cfg.model';

// Exhaustive classification: `true` = editing this field changes which day
// occurrences land on, so rescheduleTaskOnRepeatCfgUpdate$ must relocate the
// live instance. Exhaustiveness makes a new TaskRepeatCfgCopy field a compile
// error here until classified — the open-ended list this replaces silently
// missed the monthly anchor fields for years.
// Load-bearing `false` entries: lastTaskCreation* (the effect re-dispatches
// them; `true` would re-enter it), quickSetting (derived UI value — the mapped
// pattern fields carry the actual change), deletedInstanceDates (written by
// the delete-instance flow, which removes the live task itself).
const SCHEDULE_AFFECTING_BY_FIELD: Record<keyof TaskRepeatCfgCopy, boolean> = {
  id: false,
  projectId: false,
  lastTaskCreation: false,
  lastTaskCreationDay: false,
  title: false,
  tagIds: false,
  order: false,
  defaultEstimate: false,
  startTime: false,
  remindAt: false,
  isPaused: true,
  quickSetting: false,
  repeatCycle: true,
  startDate: true,
  repeatEvery: true,
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: true,
  sunday: true,
  monthlyWeekOfMonth: true,
  monthlyWeekday: true,
  monthlyLastDay: true,
  notes: false,
  shouldInheritSubtasks: false,
  repeatFromCompletionDate: false,
  waitForCompletion: false,
  disableAutoUpdateSubtasks: false,
  subTaskTemplates: false,
  deletedInstanceDates: false,
  skipOverdue: false,
};

export const SCHEDULE_AFFECTING_FIELDS = (
  Object.keys(SCHEDULE_AFFECTING_BY_FIELD) as (keyof TaskRepeatCfgCopy)[]
).filter((field) => SCHEDULE_AFFECTING_BY_FIELD[field]);
