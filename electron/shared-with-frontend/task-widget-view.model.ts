export type TaskWidgetMode = 'tracking' | 'over' | 'none' | 'focus' | 'idle';

/** The active theme's resolved CSS colors. */
export interface TaskWidgetTheme {
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  focus: string;
  warning: string;
}

/**
 * What the task widget draws. The app prepares it, so the text is already
 * translated, the time formatted and the colors taken from the theme. The
 * widget window only renders it and holds no task logic of its own.
 */
export interface TaskWidgetView {
  mode: TaskWidgetMode;
  isPaused: boolean;
  isDark: boolean;
  title: string;
  projectTitle: string;
  statusText: string;
  /** Single-line time, e.g. `24:03`, `+04:12` or `1h 12m`. */
  time: string;
  /** The same time split over two lines for the docked bar, without its sign. */
  timeStack: readonly [string, string];
  /** `+` once the time counts past its limit. It hangs beside the docked digits. */
  timeSign: string;
  /** Share of the disc that is filled, from 0 to 1. */
  ratio: number;
  /** The project's color, adjusted to stay visible on the widget. */
  projectColor: string;
  theme: TaskWidgetTheme;
  labels: Readonly<{
    start: string;
    pause: string;
    done: string;
    openApp: string;
    details: string;
  }>;
}
