import { DashboardWidgetSize } from '@super-productivity/plugin-api';

export interface DashboardLayoutItem {
  widgetId: string;
  size: DashboardWidgetSize;
  isVisible: boolean;
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
} as const;

export interface BuiltinWidgetDef {
  id: string;
  label: string;
  icon: string;
  description: string;
  defaultSize: DashboardWidgetSize;
}
