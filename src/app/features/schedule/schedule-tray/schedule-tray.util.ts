import { ScheduleDayTray, ScheduleEvent } from '../schedule.model';
import { TaskCopy } from '../../tasks/task.model';
import { SCHEDULE_TASK_MIN_DURATION_IN_MS, SVEType } from '../schedule.const';
import { getTimeLeftForTask } from '../../../util/get-time-left-for-task';
import { msToString } from '../../../ui/duration/ms-to-string.pipe';

const MINUTE_IN_MS = 60 * 1000;
const HOUR_IN_MS = 60 * MINUTE_IN_MS;

export interface TrayChip {
  id: string;
  title: string;
  // remaining estimate, '' when there is none
  time: string;
  // Both missing for a repeating task whose instance does not exist yet: there
  // is no task to open or drag (its projection cannot be dragged in the grid either).
  task?: TaskCopy;
  dragData?: ScheduleEvent;
}

export interface TrayCell {
  day: string;
  count: number;
  // each '' when it does not apply; free and over never both set
  planned: string;
  free: string;
  over: string;
  chips: TrayChip[];
  hiddenCount: number;
}

const formatDuration = (ms: number): string => msToString(ms, false, true) || '0m';

const toTaskChip = (task: TaskCopy, day: string): TrayChip => {
  const timeLeft = getTimeLeftForTask(task);
  return {
    id: task.id,
    title: task.title,
    time: timeLeft > 0 ? formatDuration(timeLeft) : '',
    task,
    dragData: {
      id: task.id,
      type: SVEType.TaskPlannedForDay,
      style: '',
      startHours: 0,
      // the drop preview is at least as long as the block the drop creates
      timeLeftInHours: Math.max(timeLeft, SCHEDULE_TASK_MIN_DURATION_IN_MS) / HOUR_IN_MS,
      plannedForDay: day,
      data: task,
      isInTray: true,
    },
  };
};

export const toTrayCell = (
  day: string,
  tray: ScheduleDayTray | undefined,
  maxChips: number,
): TrayCell => {
  const chips: TrayChip[] = [
    ...(tray?.tasks || []).map((task) => toTaskChip(task, day)),
    ...(tray?.repeatCfgs || []).map((cfg) => ({
      id: cfg.id,
      title: cfg.title || '',
      time: cfg.defaultEstimate ? formatDuration(cfg.defaultEstimate) : '',
    })),
  ];
  const plannedMs = tray?.plannedMs || 0;
  const freeMs = tray?.freeMs;
  // under a minute over still reads as "0m free", never as "0m over"
  const isOver = freeMs !== undefined && freeMs <= -MINUTE_IN_MS;
  return {
    day,
    count: chips.length,
    planned: plannedMs > 0 ? formatDuration(plannedMs) : '',
    free: freeMs !== undefined && !isOver ? formatDuration(Math.max(freeMs, 0)) : '',
    over: freeMs !== undefined && isOver ? formatDuration(-freeMs) : '',
    chips: chips.slice(0, maxChips),
    hiddenCount: Math.max(chips.length - maxChips, 0),
  };
};
