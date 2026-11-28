import type { TaskWidgetView } from '../shared-with-frontend/task-widget-view.model';
import type {
  TaskWidgetDockPreview,
  TaskWidgetLayout,
  TaskWidgetResizeSide,
} from './task-widget-layout';

interface TaskWidgetAPI {
  showMainWindow: () => void;
  toggleTask: () => void;
  markDone: () => void;
  toggleDetails: () => void;
  startResize: (side: TaskWidgetResizeSide) => void;
  resize: () => void;
  endResize: () => void;
  reportTimeWidth: (timeWidth: number) => void;
  onUpdateView: (callback: (view: TaskWidgetView) => void) => () => void;
  onUpdateLayout: (callback: (layout: TaskWidgetLayout) => void) => () => void;
  onUpdateDockPreview: (
    callback: (preview: TaskWidgetDockPreview | null) => void,
  ) => () => void;
  onUpdateDockHint: (
    callback: (hint: TaskWidgetDockPreview & { accent: string }) => void,
  ) => () => void;
  onUpdateOpacity: (callback: (opacity: number) => void) => () => void;
}

declare global {
  interface Window {
    taskWidgetAPI: TaskWidgetAPI;
  }
}

export {};
