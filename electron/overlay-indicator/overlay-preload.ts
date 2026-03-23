import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('overlayAPI', {
  showMainWindow: () => {
    ipcRenderer.send('overlay-show-main-window');
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
  onUpdateOpacity: (callback: (opacity: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, opacity: number): void =>
      callback(opacity);
    ipcRenderer.on('update-opacity', listener);

    return () => {
      ipcRenderer.removeListener('update-opacity', listener);
    };
  },
});
