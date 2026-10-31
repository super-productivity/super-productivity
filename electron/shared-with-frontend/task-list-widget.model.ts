export interface TaskListWidgetTask {
  id: string;
  title: string;
  projectTitle: string;
  timeEstimate: number;
  subTasks: { id: string; title: string }[];
}

export interface TaskListWidgetContent {
  tasks: TaskListWidgetTask[];
  isDark: boolean;
  labels: {
    all: string;
    today: string;
    empty: string;
    collapse: string;
    expand: string;
    hide: string;
    open: string;
  };
}

export interface TaskListWidgetState extends TaskListWidgetContent {
  filter: 'all' | 'today';
  isCollapsed: boolean;
}
