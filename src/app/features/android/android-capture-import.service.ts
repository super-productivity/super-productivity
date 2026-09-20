import { inject, Injectable, InjectionToken } from '@angular/core';
import { TaskService } from '../tasks/task.service';
import {
  CAPTURE_IMPORT_ERR,
  NativeCaptureImporter,
  NativeCaptureSource,
} from '../tasks/native-capture/native-capture-importer.service';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { androidInterface } from './android-interface';

/** One entry of the native `CaptureInbox` (see CaptureInbox.kt). */
export interface AndroidCapture {
  id: string;
  title: string;
  createdAt: number;
}

/** The native bridge methods backed by CaptureInbox.kt. */
export interface AndroidCaptureInbox {
  getPendingCaptures(): string | null;
  acknowledgeCapture(id: string): boolean;
}

export const ANDROID_CAPTURE_INBOX = new InjectionToken<AndroidCaptureInbox | null>(
  'ANDROID_CAPTURE_INBOX',
  {
    providedIn: 'root',
    factory: () =>
      IS_ANDROID_WEB_VIEW && androidInterface.getPendingCaptures
        ? (androidInterface as AndroidCaptureInbox)
        : null,
  },
);

export const ANDROID_CAPTURE_RECEIPTS_KEY = 'sp-android-capture-receipts';

const parseCaptures = (json: string): AndroidCapture[] => {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error(CAPTURE_IMPORT_ERR.INVALID_INBOX);
  }
  return parsed.filter(
    (c): c is AndroidCapture =>
      typeof c?.id === 'string' && typeof c?.title === 'string' && !!c.title.trim(),
  );
};

/** Imports tasks captured by the startup quick-add overlay (CaptureInbox.kt). */
@Injectable({ providedIn: 'root' })
export class AndroidCaptureImportService {
  private _inbox = inject(ANDROID_CAPTURE_INBOX);
  private _taskService = inject(TaskService);
  private _importer = inject(NativeCaptureImporter);

  /**
   * Must be called serially (startup and resume).
   * @returns the number of tasks created in this run
   */
  async importPending(): Promise<number> {
    const inbox = this._inbox;
    if (!inbox) {
      return 0;
    }
    const source: NativeCaptureSource<AndroidCapture> = {
      receiptsKey: ANDROID_CAPTURE_RECEIPTS_KEY,
      getPending: async () => {
        const json = inbox.getPendingCaptures();
        if (json === null) {
          throw new Error(CAPTURE_IMPORT_ERR.READ);
        }
        return parseCaptures(json);
      },
      isValid: () => true,
      // Same behaviour as typing into the in-app add bar: active work context
      // and short syntax. Only the id is fixed.
      createTask: (capture) => {
        this._taskService.add(capture.title, false, { id: capture.id });
      },
      acknowledge: async (id) => {
        if (!inbox.acknowledgeCapture(id)) {
          throw new Error(CAPTURE_IMPORT_ERR.ACK);
        }
      },
    };
    return (await this._importer.importPending(source)).created;
  }
}
