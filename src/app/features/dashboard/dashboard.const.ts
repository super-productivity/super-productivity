import {
  BUILTIN_WIDGET_IDS,
  BuiltinWidgetDef,
  DashboardConfig,
  TaskListWidgetConfig,
} from './dashboard.model';

export const BUILTIN_WIDGETS: BuiltinWidgetDef[] = [
  {
    id: BUILTIN_WIDGET_IDS.CURRENT_TASK,
    label: 'Current Task',
    icon: 'play_circle',
    description: 'Active task with running timer and controls',
    defaultSize: 'medium',
  },
  {
    id: BUILTIN_WIDGET_IDS.TODAY_SUMMARY,
    label: "Today's Summary",
    icon: 'today',
    description: 'Task completion progress and time tracked today',
    defaultSize: 'medium',
  },
  {
    id: BUILTIN_WIDGET_IDS.FOCUS_MODE,
    label: 'Focus Mode',
    icon: 'center_focus_strong',
    description: "Today's focus sessions and quick-start",
    defaultSize: 'small',
  },
  {
    id: BUILTIN_WIDGET_IDS.PRODUCTIVITY_STREAK,
    label: 'Productivity Streak',
    icon: 'local_fire_department',
    description: 'Activity heatmap and streak counter',
    defaultSize: 'large',
  },
  {
    id: BUILTIN_WIDGET_IDS.RECENT_ACTIVITY,
    label: 'Recent Activity',
    icon: 'history',
    description: 'Timeline of recent task completions',
    defaultSize: 'medium',
  },
  {
    id: BUILTIN_WIDGET_IDS.TASK_LIST,
    label: 'Task List',
    icon: 'checklist',
    description: "Today's tasks at a glance",
    defaultSize: 'medium',
  },
];

export const DEFAULT_TASK_LIST_CONFIG: TaskListWidgetConfig = {
  filter: 'undone',
  maxTasks: 15,
};

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  items: BUILTIN_WIDGETS.map((w) => ({
    widgetId: w.id,
    size: w.defaultSize,
    isVisible: true,
    ...(w.id === BUILTIN_WIDGET_IDS.TASK_LIST
      ? { taskListConfig: DEFAULT_TASK_LIST_CONFIG }
      : {}),
  })),
};

export const WIDGET_SIZE_COL_SPAN: Record<string, number> = {
  small: 1,
  medium: 2,
  large: 4,
};
