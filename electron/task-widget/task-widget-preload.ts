import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('taskWidgetAPI', {
  showMainWindow: () => {
    ipcRenderer.send('task-widget-show-main-window');
  },
  addNote: (content: string) => {
    ipcRenderer.send('task-widget-add-note', content);
  },
  switchTask: (taskId: string) => {
    ipcRenderer.send('task-widget-switch-task', taskId);
  },
  toggleTaskDone: (taskId: string, isDone: boolean) => {
    ipcRenderer.send('task-widget-toggle-task-done', { taskId, isDone });
  },
  setPointerInside: (isInside: boolean) => {
    ipcRenderer.send('task-widget-pointer-state', isInside);
  },
  onUpdateContent: (callback: (data: any) => void) => {
    const listener = (event: Electron.IpcRendererEvent, data: any): void =>
      callback(data);
    ipcRenderer.on('update-content', listener);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('update-content', listener);
    };
  },
  onUpdateOverview: (callback: (data: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: any): void =>
      callback(data);
    ipcRenderer.on('update-overview', listener);

    return () => {
      ipcRenderer.removeListener('update-overview', listener);
    };
  },
  onUpdateOpacity: (callback: (opacity: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, opacity: number): void =>
      callback(opacity);
    ipcRenderer.on('update-opacity', listener);

    return () => {
      ipcRenderer.removeListener('update-opacity', listener);
    };
  },
  onCollapsedState: (
    callback: (state: {
      isCollapsed: boolean;
      edge: 'left' | 'right' | 'top' | 'bottom';
      collapsedWidth: number;
    }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: {
        isCollapsed: boolean;
        edge: 'left' | 'right' | 'top' | 'bottom';
        collapsedWidth: number;
      },
    ): void => callback(state);
    ipcRenderer.on('collapsed-state', listener);

    return () => {
      ipcRenderer.removeListener('collapsed-state', listener);
    };
  },
});
