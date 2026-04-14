import { DashboardWidgetSize } from '@super-productivity/plugin-api';

export type TaskListFilter = 'undone' | 'done' | 'all';

export type MobileWidgetSize = DashboardWidgetSize | 'hidden';

export interface TaskListWidgetConfig {
  filter: TaskListFilter;
  maxTasks: number;
  projectId?: string | null;
  tagId?: string | null;
}

export interface DashboardLayoutItem {
  widgetId: string;
  size: DashboardWidgetSize;
  mobileSize?: MobileWidgetSize;
  isVisible: boolean;
  taskListConfig?: TaskListWidgetConfig;
}

export type DashboardConfig = Readonly<{
  items: DashboardLayoutItem[];
}>;

export const BUILTIN_WIDGET_IDS = {
  CURRENT_TASK: 'builtin:current-task',
  TODAY_SUMMARY: 'builtin:today-summary',
  FOCUS_MODE: 'builtin:focus-mode',
  PRODUCTIVITY_STREAK: 'builtin:productivity-streak',
  RECENT_ACTIVITY: 'builtin:recent-activity',
  TASK_LIST: 'builtin:task-list',
  NOTES: 'builtin:notes',
} as const;

export interface BuiltinWidgetDef {
  id: string;
  label: string;
  icon: string;
  description: string;
  defaultSize: DashboardWidgetSize;
}
