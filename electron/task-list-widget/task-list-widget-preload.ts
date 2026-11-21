import { contextBridge, ipcRenderer } from 'electron';
import type { TaskListWidgetState } from '../shared-with-frontend/task-list-widget.model';

contextBridge.exposeInMainWorld('taskListWidgetAPI', {
  onUpdate: (callback: (state: TaskListWidgetState) => void) => {
    ipcRenderer.on('task-list-widget-state', (_event, state: TaskListWidgetState) =>
      callback(state),
    );
  },
  setFilter: (filter: 'all' | 'today') =>
    ipcRenderer.send('task-list-widget-filter', filter),
  toggleCollapsed: () => ipcRenderer.send('task-list-widget-collapse'),
  hide: () => ipcRenderer.send('task-list-widget-hide'),
  openApp: () => ipcRenderer.send('task-list-widget-open'),
});
