import { T } from '../../../t.const';
import {
  buildTaskWidgetView,
  getVisibleProjectColor,
  TaskWidgetViewInput,
} from './build-task-widget-view';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const FOUR_MIN = 4 * MIN;
const TWELVE_MIN = 12 * MIN;

const THEME = {
  surface: 'rgb(36, 36, 36)',
  text: 'rgb(230, 230, 230)',
  textMuted: 'rgba(235, 235, 235, 0.65)',
  border: 'rgba(255, 255, 255, 0.12)',
  primary: 'rgb(100, 149, 237)',
  focus: 'rgb(255, 64, 129)',
  warning: '#ff9800',
};

const buildView = (
  overrides: Partial<TaskWidgetViewInput> = {},
): ReturnType<typeof buildTaskWidgetView> =>
  buildTaskWidgetView({
    task: { title: 'Write report', timeEstimate: 0, timeSpent: 0 },
    isTracking: true,
    projectTitle: 'Website',
    projectColor: '#29a1aa',
    focusTimer: null,
    isDark: true,
    theme: THEME,
    translate: (key, params) => (params ? `${key} ${params.estimate}` : key),
    ...overrides,
  });

const contrastAgainst = (rgb: string, background: number[]): number => {
  const channels = (rgb.match(/\d+/g) as string[]).map(Number);
  const luminance = (color: number[]): number => {
    const [r, g, b] = color.map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    // prettier-ignore
    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
  };
  const a = luminance(channels);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

describe('buildTaskWidgetView', () => {
  describe('task with an estimate', () => {
    it('counts down and fills the disc with the time left', () => {
      const view = buildView({
        task: { title: 'A', timeEstimate: HOUR, timeSpent: 45 * MIN },
      });

      expect(view.mode).toBe('tracking');
      expect(view.time).toBe('15:00');
      expect(view.timeStack).toEqual(['15', '00']);
      expect(view.timeSign).toBe('');
      expect(view.ratio).toBeCloseTo(0.25);
      expect(view.statusText).toBe(`${T.F.TASK_WIDGET.TIME_LEFT} 1h`);
    });

    it('switches to over estimate exactly when the estimate is used up', () => {
      const view = buildView({
        task: { title: 'A', timeEstimate: HOUR, timeSpent: HOUR },
      });

      expect(view.mode).toBe('over');
      expect(view.time).toBe('+00:00');
    });

    it('marks time past the estimate with a plus and a full disc', () => {
      const view = buildView({
        task: { title: 'A', timeEstimate: HOUR, timeSpent: HOUR + FOUR_MIN + 12000 },
      });

      expect(view.mode).toBe('over');
      expect(view.time).toBe('+04:12');
      expect(view.timeStack).toEqual(['04', '12']);
      expect(view.timeSign).toBe('+');
      expect(view.ratio).toBe(1);
    });

    it('keeps the plus past an hour over', () => {
      const view = buildView({
        task: { title: 'A', timeEstimate: HOUR, timeSpent: HOUR + HOUR + TWELVE_MIN },
      });

      expect(view.time).toBe('+1h 12m');
      expect(view.timeStack).toEqual(['1h', '12']);
      expect(view.timeSign).toBe('+');
    });
  });

  describe('task without an estimate', () => {
    it('counts time spent and leaves the disc empty', () => {
      const view = buildView({
        task: { title: 'A', timeEstimate: 0, timeSpent: 72 * MIN },
      });

      expect(view.mode).toBe('none');
      expect(view.time).toBe('1h 12m');
      expect(view.timeStack).toEqual(['1h', '12']);
      expect(view.ratio).toBe(0);
      expect(view.statusText).toBe(T.F.TASK_WIDGET.NO_ESTIMATE);
    });

    it('stays readable past ten hours', () => {
      const view = buildView({
        task: { title: 'A', timeEstimate: 0, timeSpent: 12 * HOUR },
      });

      expect(view.time).toBe('12h 00m');
    });
  });

  describe('paused', () => {
    it('keeps the mode, so pausing over estimate does not look like time left', () => {
      const view = buildView({
        task: { title: 'A', timeEstimate: HOUR, timeSpent: HOUR + FOUR_MIN },
        isTracking: false,
      });

      expect(view.isPaused).toBe(true);
      expect(view.mode).toBe('over');
      expect(view.time).toBe('+04:00');
      expect(view.ratio).toBe(1);
      expect(view.statusText).toBe(T.F.TASK_WIDGET.PAUSED);
    });

    it('keeps the wedge where it stopped', () => {
      const view = buildView({
        task: { title: 'A', timeEstimate: HOUR, timeSpent: 30 * MIN },
        isTracking: false,
      });

      expect(view.mode).toBe('tracking');
      expect(view.ratio).toBeCloseTo(0.5);
    });
  });

  describe('focus session', () => {
    const focusTimer = { isRunning: true, elapsed: 10 * MIN, duration: 25 * MIN };

    it('shows the session time instead of the task time', () => {
      const view = buildView({
        task: { title: 'A', timeEstimate: HOUR, timeSpent: 30 * MIN },
        focusTimer,
      });

      expect(view.mode).toBe('focus');
      expect(view.time).toBe('15:00');
      expect(view.ratio).toBeCloseTo(0.6);
      expect(view.title).toBe('A');
      expect(view.statusText).toBe(T.F.TASK_WIDGET.FOCUS_SESSION);
    });

    it('follows the session when it is paused, not the task', () => {
      const view = buildView({
        focusTimer: { ...focusTimer, isRunning: false },
        isTracking: true,
      });

      expect(view.isPaused).toBe(true);
      expect(view.mode).toBe('focus');
    });

    it('counts up with an empty disc for an open-ended session', () => {
      const view = buildView({
        focusTimer: { isRunning: true, elapsed: 5 * MIN, duration: 0 },
      });

      expect(view.mode).toBe('focus');
      expect(view.time).toBe('05:00');
      expect(view.ratio).toBe(0);
    });

    it('treats running past the session length as over', () => {
      const view = buildView({
        focusTimer: { isRunning: true, elapsed: 27 * MIN, duration: 25 * MIN },
      });

      expect(view.mode).toBe('over');
      expect(view.time).toBe('+02:00');
    });

    it('works without a task and names the session instead', () => {
      const view = buildView({ task: null, isTracking: false, focusTimer });

      expect(view.mode).toBe('focus');
      expect(view.title).toBe(T.F.TASK_WIDGET.FOCUS_SESSION);
    });
  });

  describe('nothing to show', () => {
    it('shows the empty state', () => {
      const view = buildView({ task: null, isTracking: false, projectTitle: '' });

      expect(view.mode).toBe('idle');
      expect(view.isPaused).toBe(false);
      expect(view.title).toBe(T.F.TASK_WIDGET.NO_ACTIVE_TASK);
      expect(view.time).toBe('');
      expect(view.timeStack).toEqual(['', '']);
      expect(view.timeSign).toBe('');
    });
  });

  it('passes the theme and translated labels through', () => {
    const view = buildView({ isDark: false });

    expect(view.isDark).toBe(false);
    expect(view.theme).toBe(THEME);
    expect(view.labels).toEqual({
      start: T.F.TASK_WIDGET.START,
      pause: T.F.TASK_WIDGET.PAUSE,
      done: T.F.TASK_WIDGET.MARK_DONE,
      openApp: T.F.TASK_WIDGET.OPEN_APP,
      details: T.F.TASK_WIDGET.SHOW_DETAILS,
    });
  });
});

describe('getVisibleProjectColor', () => {
  const EXTREME_COLORS = [
    '#29a1aa',
    '#0b1f5c',
    '#000000',
    '#ffffff',
    '#f2f2f0',
    '#8a8a8a',
    '#e53935',
    '#f7e51e',
    '#abc',
  ];

  EXTREME_COLORS.forEach((color) => {
    it(`keeps ${color} visible on a dark surface`, () => {
      expect(
        contrastAgainst(getVisibleProjectColor(color, true), [36, 36, 36]),
      ).toBeGreaterThan(3);
    });

    it(`keeps ${color} visible on a light surface`, () => {
      expect(
        contrastAgainst(getVisibleProjectColor(color, false), [255, 255, 255]),
      ).toBeGreaterThan(3);
    });
  });

  it('leaves a color alone when it is already visible', () => {
    expect(getVisibleProjectColor('#29a1aa', true)).toBe('rgb(41, 161, 170)');
  });

  it('falls back when a project has no usable color', () => {
    expect(getVisibleProjectColor(undefined, true)).toBe('rgb(100, 149, 237)');
    expect(getVisibleProjectColor('not-a-color', true)).toBe('rgb(100, 149, 237)');
  });
});
