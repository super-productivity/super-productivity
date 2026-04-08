interface TaskWidgetContentData {
  title: string;
  time: string;
  mode: 'pomodoro' | 'focus' | 'task' | 'idle';
}

interface TaskWidgetAPI {
  showMainWindow: () => void;
  onUpdateContent: (callback: (data: TaskWidgetContentData) => void) => () => void;
  onUpdateOpacity: (callback: (opacity: number) => void) => () => void;
}

declare global {
  interface Window {
    taskWidgetAPI: TaskWidgetAPI;
  }
}

export {};
