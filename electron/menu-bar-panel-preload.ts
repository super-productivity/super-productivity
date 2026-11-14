import { contextBridge, ipcRenderer } from 'electron';

/**
 * Tight bridge for the macOS menu bar panel. Exposes only the panel's state and
 * the handful of actions it can request; the panel renderer has no access to
 * Node or the generic IPC surface.
 *
 * Channel names are literals (not the shared IPC enum) on purpose: a sandboxed
 * preload cannot require a local module, and it must match
 * `shared-with-frontend/ipc-events.const.ts`.
 */

export type MenuBarPanelAction =
  | { type: 'toggleTask'; id: string }
  | { type: 'completeTask'; id: string }
  | { type: 'addTask'; title: string }
  | { type: 'showApp' }
  | { type: 'hide' };

export interface MenuBarPanelBridge {
  getState: () => Promise<unknown>;
  onState: (callback: (state: unknown) => void) => () => void;
  toggleTask: (id: string) => void;
  completeTask: (id: string) => void;
  addTask: (title: string) => void;
  showApp: () => void;
  hide: () => void;
}

const sendAction = (action: MenuBarPanelAction): void => {
  ipcRenderer.send('MENU_BAR_PANEL_ACTION', action);
};

const bridge: MenuBarPanelBridge = {
  getState: () => ipcRenderer.invoke('MENU_BAR_PANEL_GET_STATE'),
  onState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown): void =>
      callback(state);
    ipcRenderer.on('MENU_BAR_PANEL_STATE', listener);
    return () => {
      ipcRenderer.removeListener('MENU_BAR_PANEL_STATE', listener);
    };
  },
  toggleTask: (id) => sendAction({ type: 'toggleTask', id }),
  completeTask: (id) => sendAction({ type: 'completeTask', id }),
  addTask: (title) => sendAction({ type: 'addTask', title }),
  showApp: () => sendAction({ type: 'showApp' }),
  hide: () => sendAction({ type: 'hide' }),
};

contextBridge.exposeInMainWorld('menuBarPanel', bridge);
