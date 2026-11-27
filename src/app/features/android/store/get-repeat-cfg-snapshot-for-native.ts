import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';

// The fields the native repeat-reminder port reads (RepeatCfg.kt). Notes and
// subtask templates stay out: they are never needed to schedule an alarm.
const SCHEDULE_KEYS = [
  'id',
  'title',
  'projectId',
  'tagIds',
  'lastTaskCreation',
  'lastTaskCreationDay',
  'startTime',
  'remindAt',
  'isPaused',
  'repeatCycle',
  'startDate',
  'repeatUntilDay',
  'repeatEvery',
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'monthlyWeekOfMonth',
  'monthlyWeekday',
  'monthlyLastDay',
  'repeatFromCompletionDate',
  'waitForCompletion',
  'deletedInstanceDates',
] as const satisfies readonly (keyof TaskRepeatCfg)[];

/**
 * JSON of every repeat config's schedule fields plus the archived project ids,
 * for the Android background worker. It replaces the worker's own cache, so a
 * config it never saw an op for (created before background sync was on) or
 * one removed by an op it does not fold still ends up right.
 */
export const getRepeatCfgSnapshotForNative = (
  cfgs: readonly TaskRepeatCfg[],
  archivedProjectIds: ReadonlySet<string>,
): string =>
  JSON.stringify({
    cfgs: cfgs.map((cfg) => {
      const picked: Partial<Record<(typeof SCHEDULE_KEYS)[number], unknown>> = {};
      for (const key of SCHEDULE_KEYS) {
        if (cfg[key] !== undefined) picked[key] = cfg[key];
      }
      return picked;
    }),
    archivedProjectIds: [...archivedProjectIds].sort(),
  });
