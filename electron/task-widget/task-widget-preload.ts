import { contextBridge, ipcRenderer } from 'electron';
import type { TaskWidgetView } from '../shared-with-frontend/task-widget-view.model';
import type {
  TaskWidgetDockPreview,
  TaskWidgetLayout,
  TaskWidgetResizeSide,
} from './task-widget-layout';

const subscribe = <T>(channel: string, callback: (data: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, data: T): void => callback(data);
  ipcRenderer.on(channel, listener);

  // Return cleanup function
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

contextBridge.exposeInMainWorld('taskWidgetAPI', {
  showMainWindow: () => {
    ipcRenderer.send('task-widget-show-main-window');
  },
  toggleTask: () => {
    ipcRenderer.send('task-widget-toggle-task');
  },
  markDone: () => {
    ipcRenderer.send('task-widget-mark-done');
  },
  toggleDetails: () => {
    ipcRenderer.send('task-widget-toggle-details');
  },
  startResize: (side: TaskWidgetResizeSide) => {
    ipcRenderer.send('task-widget-resize-start', side);
  },
  resize: () => {
    ipcRenderer.send('task-widget-resize');
  },
  endResize: () => {
    ipcRenderer.send('task-widget-resize-end');
  },
  reportTimeWidth: (timeWidth: number) => {
    ipcRenderer.send('task-widget-time-width', timeWidth);
  },
  onUpdateView: (callback: (view: TaskWidgetView) => void) =>
    subscribe('update-view', callback),
  onUpdateLayout: (callback: (layout: TaskWidgetLayout) => void) =>
    subscribe('update-layout', callback),
  onUpdateDockPreview: (callback: (preview: TaskWidgetDockPreview | null) => void) =>
    subscribe('update-dock-preview', callback),
  onUpdateDockHint: (
    callback: (hint: TaskWidgetDockPreview & { accent: string }) => void,
  ) => subscribe('update-dock-hint', callback),
  onUpdateOpacity: (callback: (opacity: number) => void) =>
    subscribe('update-opacity', callback),
});
