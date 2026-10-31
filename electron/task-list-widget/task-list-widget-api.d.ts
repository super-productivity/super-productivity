import type { TaskListWidgetState } from '../shared-with-frontend/task-list-widget.model';

declare global {
  interface Window {
    taskListWidgetAPI: {
      onUpdate(callback: (state: TaskListWidgetState) => void): void;
      setFilter(filter: 'all' | 'today'): void;
      toggleCollapsed(): void;
      hide(): void;
      openApp(): void;
    };
  }
}
