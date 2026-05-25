import { TaskWidgetOverview } from '../../src/app/features/tasks/task-widget-overview.model';

interface TaskWidgetContentData {
  title: string;
  time: string;
  mode: 'pomodoro' | 'focus' | 'task' | 'idle';
}

interface TaskWidgetAPI {
  showMainWindow: () => void;
  addNote: (content: string) => void;
  switchTask: (taskId: string) => void;
  toggleTaskDone: (taskId: string, isDone: boolean) => void;
  setPointerInside: (isInside: boolean) => void;
  onUpdateContent: (callback: (data: TaskWidgetContentData) => void) => () => void;
  onUpdateOverview: (callback: (data: TaskWidgetOverview | null) => void) => () => void;
  onUpdateOpacity: (callback: (opacity: number) => void) => () => void;
  onCollapsedState: (
    callback: (state: {
      isCollapsed: boolean;
      edge: 'left' | 'right' | 'top' | 'bottom';
      collapsedWidth: number;
    }) => void,
  ) => () => void;
}

declare global {
  interface Window {
    taskWidgetAPI: TaskWidgetAPI;
  }
}

export {};
