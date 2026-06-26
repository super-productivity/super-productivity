import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './shared-with-frontend/ipc-events.const';
import type {
  AddTaskPayload,
  AddTaskSubmitResult,
} from '../src/app/features/tasks/add-task-bar/add-task-payload-builder';
import type { QuickAddSnapshotResult } from '../src/app/features/tasks/add-task-bar/quick-add-hud.model';

const ea = {
  closeQuickAdd: (): void => ipcRenderer.send(IPC.QUICK_ADD_CLOSE),
  submitQuickAddTask: (payload: AddTaskPayload): Promise<AddTaskSubmitResult> =>
    ipcRenderer.invoke(
      IPC.QUICK_ADD_TASK_SUBMIT_REQUEST,
      payload,
    ) as Promise<AddTaskSubmitResult>,
  requestQuickAddSnapshot: (): Promise<QuickAddSnapshotResult> =>
    ipcRenderer.invoke(IPC.QUICK_ADD_SNAPSHOT_REQUEST) as Promise<QuickAddSnapshotResult>,
  onQuickAddOpened: (listener: () => void): (() => void) => {
    const ipcListener = (): void => listener();
    ipcRenderer.on(IPC.QUICK_ADD_OPENED, ipcListener);
    return () => ipcRenderer.off(IPC.QUICK_ADD_OPENED, ipcListener);
  },
};

contextBridge.exposeInMainWorld('ea', ea);
