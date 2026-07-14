import { ipcEvent$ } from '../util/ipc-event';
import { IPC } from '../../../electron/shared-with-frontend/ipc-events.const';
import { map, filter } from 'rxjs/operators';
import { EMPTY, Observable } from 'rxjs';
import { IS_ELECTRON } from '../app.constants';

export const parseAddTaskFromAppUriPayload = (
  data: unknown,
): { title: string } | null => {
  if (
    !data ||
    typeof data !== 'object' ||
    typeof (data as { title?: unknown }).title !== 'string'
  ) {
    return null;
  }
  return data as { title: string };
};

export const parseBeforeCloseIdsPayload = (data: unknown): string[] =>
  Array.isArray(data) && data.every((id) => typeof id === 'string') ? data : [];

export const ipcIdleTime$: Observable<number> = IS_ELECTRON
  ? ipcEvent$(IPC.IDLE_TIME).pipe(map(([idleTimeInMs]) => idleTimeInMs as number))
  : EMPTY;

export const ipcAnyFileDownloaded$: Observable<unknown> = IS_ELECTRON
  ? ipcEvent$(IPC.ANY_FILE_DOWNLOADED).pipe()
  : EMPTY;

export const ipcNotifyOnClose$: Observable<string[]> = IS_ELECTRON
  ? ipcEvent$(IPC.NOTIFY_ON_CLOSE).pipe(map(([ids]) => parseBeforeCloseIdsPayload(ids)))
  : EMPTY;

export const ipcResume$: Observable<unknown> = IS_ELECTRON
  ? ipcEvent$(IPC.RESUME).pipe()
  : EMPTY;
export const ipcSuspend$: Observable<unknown> = IS_ELECTRON
  ? ipcEvent$(IPC.SUSPEND).pipe()
  : EMPTY;

export const ipcEnterFullScreen$: Observable<unknown> = IS_ELECTRON
  ? ipcEvent$(IPC.ENTER_FULL_SCREEN).pipe()
  : EMPTY;
export const ipcLeaveFullScreen$: Observable<unknown> = IS_ELECTRON
  ? ipcEvent$(IPC.LEAVE_FULL_SCREEN).pipe()
  : EMPTY;

export const ipcShowAddTaskBar$: Observable<unknown> = IS_ELECTRON
  ? ipcEvent$(IPC.SHOW_ADD_TASK_BAR).pipe()
  : EMPTY;

export const ipcAddTaskFromAppUri$: Observable<{ title: string } | null> = IS_ELECTRON
  ? ipcEvent$(IPC.ADD_TASK_FROM_APP_URI).pipe(
      map(([data]) => parseAddTaskFromAppUriPayload(data)),
      filter((data): data is { title: string } => data !== null),
    )
  : EMPTY;
