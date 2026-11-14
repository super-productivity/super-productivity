// Ambient types for the menu bar panel renderer. This file intentionally has no
// imports/exports: the renderer is compiled as a plain browser script (not a
// CommonJS module), so `tsc` must not emit `exports` references into it.

interface MenuBarPanelTask {
  id: string;
  title: string;
  timeEstimate?: number;
  timeSpent?: number;
}

interface MenuBarPanelState {
  todayTasks: MenuBarPanelTask[];
  currentTask: MenuBarPanelTask | null;
  isRunning: boolean;
  isFocusModeEnabled: boolean;
  focusSessionTime: number;
  focusModeMode?: string;
}

interface MenuBarPanelBridge {
  getState: () => Promise<unknown>;
  onState: (callback: (state: unknown) => void) => () => void;
  toggleTask: (id: string) => void;
  completeTask: (id: string) => void;
  addTask: (title: string) => void;
  showApp: () => void;
  hide: () => void;
}

interface Window {
  menuBarPanel: MenuBarPanelBridge;
}
