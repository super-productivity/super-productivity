import { T } from '../../../t.const';
import { msToString } from '../../../ui/duration/ms-to-string.pipe';
import { TimerState } from '../../focus-mode/focus-mode.model';
import { Task } from '../task.model';
import {
  TaskWidgetMode,
  TaskWidgetTheme,
  TaskWidgetView,
} from '../../../../../electron/shared-with-frontend/task-widget-view.model';

export type TaskWidgetViewInput = Readonly<{
  task: Pick<Task, 'title' | 'timeEstimate' | 'timeSpent'> | null;
  isTracking: boolean;
  projectTitle: string;
  projectColor?: string | null;
  focusTimer: Pick<TimerState, 'isRunning' | 'elapsed' | 'duration'> | null;
  isDark: boolean;
  theme: TaskWidgetTheme;
  translate: (key: string, params?: Record<string, string>) => string;
}>;

type Timing = Readonly<{
  mode: TaskWidgetMode;
  ms: number;
  ratio: number;
  statusText: string;
  prefix?: string;
}>;

const FALLBACK_COLOR = '#6495ed';
// The usual card surfaces. Custom themes stay close enough for a small dot.
const SURFACE_DARK = [36, 36, 36];
const SURFACE_LIGHT = [255, 255, 255];
// WCAG non-text contrast, so the dot stays visible for any project color.
const MIN_COLOR_CONTRAST = 3;
const COLOR_STEP = 0.04;

const pad = (value: number): string => value.toString().padStart(2, '0');

const formatTime = (
  ms: number,
  prefix: string = '',
): Pick<TaskWidgetView, 'time' | 'timeStack' | 'timeSign'> => {
  const totalSeconds = Math.floor(Math.max(ms, 0) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  // Above an hour seconds would only add noise, and the short form keeps the
  // title readable next to the time.
  return hours > 0
    ? {
        time: `${prefix}${hours}h ${pad(minutes)}m`,
        timeStack: [`${hours}h`, pad(minutes)],
        timeSign: prefix,
      }
    : {
        time: `${prefix}${pad(minutes)}:${pad(seconds)}`,
        timeStack: [pad(minutes), pad(seconds)],
        timeSign: prefix,
      };
};

const parseHexColor = (color: string | null | undefined): number[] | null => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color ?? '')?.[1];
  if (!hex) {
    return null;
  }
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

const getLuminance = (rgb: number[]): number => {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  // prettier-ignore
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
};

const getContrast = (a: number[], b: number[]): number => {
  const lumA = getLuminance(a);
  const lumB = getLuminance(b);
  return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
};

/** Moves a project color toward white or black until it shows on the widget. */
export const getVisibleProjectColor = (
  color: string | null | undefined,
  isDark: boolean,
): string => {
  const rgb = parseHexColor(color) ?? (parseHexColor(FALLBACK_COLOR) as number[]);
  const surface = isDark ? SURFACE_DARK : SURFACE_LIGHT;
  const target = isDark ? 255 : 0;

  for (let mix = 0; mix < 1; mix += COLOR_STEP) {
    const candidate = rgb.map((channel) => {
      const shift = (target - channel) * mix;
      return Math.round(channel + shift);
    });
    if (getContrast(candidate, surface) >= MIN_COLOR_CONTRAST) {
      return `rgb(${candidate.join(', ')})`;
    }
  }
  return `rgb(${target}, ${target}, ${target})`;
};

const getTaskTiming = (
  task: NonNullable<TaskWidgetViewInput['task']>,
  translate: TaskWidgetViewInput['translate'],
): Timing => {
  if (!task.timeEstimate) {
    return {
      mode: 'none',
      ms: task.timeSpent,
      ratio: 0,
      statusText: translate(T.F.TASK_WIDGET.NO_ESTIMATE),
    };
  }

  const remaining = task.timeEstimate - task.timeSpent;
  return remaining > 0
    ? {
        mode: 'tracking',
        ms: remaining,
        ratio: remaining / task.timeEstimate,
        statusText: translate(T.F.TASK_WIDGET.TIME_LEFT, {
          estimate: msToString(task.timeEstimate),
        }),
      }
    : {
        mode: 'over',
        ms: -remaining,
        ratio: 1,
        statusText: translate(T.F.TASK_WIDGET.OVER_ESTIMATE),
        prefix: '+',
      };
};

const getFocusTiming = (
  timer: NonNullable<TaskWidgetViewInput['focusTimer']>,
  translate: TaskWidgetViewInput['translate'],
): Timing => {
  const statusText = translate(T.F.TASK_WIDGET.FOCUS_SESSION);

  // Flowtime sessions have no target, so they count up and leave the disc empty.
  if (!timer.duration) {
    return { mode: 'focus', ms: timer.elapsed, ratio: 0, statusText };
  }

  const remaining = timer.duration - timer.elapsed;
  return remaining > 0
    ? { mode: 'focus', ms: remaining, ratio: remaining / timer.duration, statusText }
    : { mode: 'over', ms: -remaining, ratio: 1, statusText, prefix: '+' };
};

export const buildTaskWidgetView = ({
  task,
  isTracking,
  projectTitle,
  projectColor,
  focusTimer,
  isDark,
  theme,
  translate,
}: TaskWidgetViewInput): TaskWidgetView => {
  const common = {
    isDark,
    theme,
    projectColor: getVisibleProjectColor(projectColor, isDark),
    labels: {
      start: translate(T.F.TASK_WIDGET.START),
      pause: translate(T.F.TASK_WIDGET.PAUSE),
      done: translate(T.F.TASK_WIDGET.MARK_DONE),
      openApp: translate(T.F.TASK_WIDGET.OPEN_APP),
      details: translate(T.F.TASK_WIDGET.SHOW_DETAILS),
    },
  };

  if (!task && !focusTimer) {
    return {
      ...common,
      mode: 'idle',
      isPaused: false,
      title: translate(T.F.TASK_WIDGET.NO_ACTIVE_TASK),
      projectTitle: '',
      statusText: '',
      time: '',
      timeStack: ['', ''],
      timeSign: '',
      ratio: 0,
    };
  }

  const timing = focusTimer
    ? getFocusTiming(focusTimer, translate)
    : getTaskTiming(task as NonNullable<TaskWidgetViewInput['task']>, translate);
  const isPaused = focusTimer ? !focusTimer.isRunning : !isTracking;

  return {
    ...common,
    mode: timing.mode,
    isPaused,
    title: task?.title || timing.statusText,
    projectTitle,
    statusText: isPaused ? translate(T.F.TASK_WIDGET.PAUSED) : timing.statusText,
    ...formatTime(timing.ms, timing.prefix),
    ratio: Math.min(Math.max(timing.ratio, 0), 1),
  };
};
