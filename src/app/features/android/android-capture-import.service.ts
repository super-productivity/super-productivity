import { inject, Injectable, InjectionToken } from '@angular/core';
import { Store } from '@ngrx/store';
import { TaskService } from '../tasks/task.service';
import {
  CAPTURE_IMPORT_ERR,
  NativeCaptureImporter,
  NativeCaptureSource,
} from '../tasks/native-capture/native-capture-importer.service';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { androidInterface } from './android-interface';
import {
  addInboxTaskAction,
  AgentCapture,
  toCaptureTask,
} from '../tasks/agent-capture/super-sync-capture-source';
import { GlobalConfigService } from '../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';

/** One entry of the native `CaptureInbox` (see CaptureInbox.kt). */
export interface AndroidCapture {
  id: string;
  title: string;
  createdAt: number;
}

/** The native bridge methods backed by CaptureInbox.kt. */
export interface AndroidCaptureInbox {
  /** Title-only captures; share entries are left out natively. */
  getPendingCaptures(): string | null;
  /**
   * Share entries (ShareReceiverActivity) as v1 capture payloads plus `id`,
   * after taking over those still waiting to upload. Absent on older APKs.
   */
  getPendingShares?(): string | null;
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
/** Never rename: installs keep their receipts under it. */
export const ANDROID_SHARE_RECEIPTS_KEY = 'sp-android-share-receipts';
/** As for iOS shares; the share never left this device, so the server's 8 KiB does not apply. */
const SHARE_NOTES_MAX_CHARS = 100_000;

const parseShares = (json: string): AgentCapture[] => {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error(CAPTURE_IMPORT_ERR.INVALID_INBOX);
  }
  return parsed
    .filter((entry): entry is { id: string } => typeof entry?.id === 'string')
    .map((entry) => ({
      id: entry.id,
      task: toCaptureTask(entry, SHARE_NOTES_MAX_CHARS),
    }));
};

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

/**
 * Imports CaptureInbox.kt: Android shares, and title-only tasks left by the
 * removed startup quick-add overlay of an older app version.
 */
@Injectable({ providedIn: 'root' })
export class AndroidCaptureImportService {
  private _inbox = inject(ANDROID_CAPTURE_INBOX);
  private _taskService = inject(TaskService);
  private _importer = inject(NativeCaptureImporter);
  private _store = inject(Store);
  private _globalConfig = inject(GlobalConfigService);

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
    const created = (await this._importer.importPending(source)).created;
    return created + (await this._importShares(inbox));
  }

  /**
   * Same task as a share that went through SuperSync capture: one Inbox
   * addTask, short syntax kept literal, the link as its attachment.
   */
  private async _importShares(inbox: AndroidCaptureInbox): Promise<number> {
    const getPendingShares = inbox.getPendingShares?.bind(inbox);
    if (!getPendingShares) {
      return 0;
    }
    const source: NativeCaptureSource<AgentCapture> = {
      receiptsKey: ANDROID_SHARE_RECEIPTS_KEY,
      getPending: async () => {
        const json = getPendingShares();
        if (json === null) {
          throw new Error(CAPTURE_IMPORT_ERR.READ);
        }
        return parseShares(json);
      },
      isValid: (share) => share.task !== null,
      createTask: (share) => {
        const cfg = this._globalConfig.cfg();
        this._store.dispatch(
          addInboxTaskAction(
            share,
            cfg?.timeTracking.defaultEstimate || 0,
            cfg?.reminder.defaultTaskRemindOption ??
              DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
          ),
        );
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
