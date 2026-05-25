export type TaskWidgetGoalValueType = 'count' | 'duration';

export interface TaskWidgetTask {
  id: string;
  title: string;
  timeEstimate?: number;
  timeSpent?: number;
  isDone?: boolean;
  projectId?: string | null;
  projectTitle?: string;
  dueDay?: string | null;
  dueWithTime?: number | null;
}

export interface TaskWidgetNote {
  id: string;
  content: string;
}

export interface TaskWidgetGoal {
  id: string;
  title: string;
  value: number;
  target: number;
  valueType: TaskWidgetGoalValueType;
  isReached: boolean;
}

export interface TaskWidgetPlannerDay {
  dayDate: string;
  tasks: TaskWidgetTask[];
}

export interface TaskWidgetProjectGroup {
  id: string;
  title: string;
  tasks: TaskWidgetTask[];
}

export interface TaskWidgetOverview {
  todayTasks: TaskWidgetTask[];
  overdueTasks: TaskWidgetTask[];
  projectTaskGroups: TaskWidgetProjectGroup[];
  timelineTasks: TaskWidgetTask[];
  plannerDays: TaskWidgetPlannerDay[];
  todayNotes: TaskWidgetNote[];
  projectNotes: TaskWidgetNote[];
  activeContextTitle: string;
  simpleCounterGoals: TaskWidgetGoal[];
}
