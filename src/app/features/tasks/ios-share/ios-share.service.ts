import { DestroyRef, inject, Injectable, InjectionToken } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { registerPlugin } from '@capacitor/core';
import { Store } from '@ngrx/store';
import { concatMap, startWith } from 'rxjs';
import { Log } from '../../../core/log';
import { SnackService } from '../../../core/snack/snack.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { IS_IOS_NATIVE } from '../../../util/is-native-platform';
import { INBOX_PROJECT } from '../../project/project.const';
import { WorkContextType } from '../../work-context/work-context.model';
import { DEFAULT_TASK } from '../task.model';
import { iosInterface } from '../../ios/ios-interface';
import {
  CAPTURE_IMPORT_ERR,
  getCaptureImportErrorReason,
  NativeCaptureImporter,
  NativeCaptureSource,
} from '../native-capture/native-capture-importer.service';

interface IosShare {
  id: string;
  title: string;
  text: string;
}

export interface IosSharePlugin {
  getPending(): Promise<{ shares: IosShare[] }>;
  acknowledge(options: { id: string }): Promise<void>;
}

export const IOS_SHARE = new InjectionToken<IosSharePlugin | null>('IOS_SHARE', {
  providedIn: 'root',
  factory: () => (IS_IOS_NATIVE ? registerPlugin<IosSharePlugin>('ShareInbox') : null),
});

const RECEIPTS_KEY = 'sp-ios-share-receipts';

@Injectable({ providedIn: 'root' })
export class IosShareService {
  private _plugin = inject(IOS_SHARE);
  private _store = inject(Store);
  private _importer = inject(NativeCaptureImporter);
  private _destroyRef = inject(DestroyRef);
  private _snack = inject(SnackService);

  start(): void {
    if (!this._plugin) {
      return;
    }
    iosInterface.onResume$
      .pipe(
        startWith(null),
        concatMap(() =>
          this.importPending().catch((e: unknown) => {
            Log.err('iOS share import failed; pending captures retained', {
              reason: getCaptureImportErrorReason(e),
            });
            this._snack.open({ type: 'ERROR', msg: 'F.IOS_SHARE.IMPORT_ERROR' });
          }),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe();
  }

  /** Called serially at startup and on resume; the extension never writes app state. */
  async importPending(): Promise<void> {
    const plugin = this._plugin;
    if (!plugin) {
      return;
    }
    const source: NativeCaptureSource<IosShare> = {
      receiptsKey: RECEIPTS_KEY,
      getPending: async () => (await plugin.getPending()).shares,
      // The native extension enforces the same existing external-input limits.
      // Check again before a bridge payload becomes a synced task.
      isValid: (share) => !!share.text.trim() && share.text.length <= 100_000,
      createTask: (share) => this._store.dispatch(addInboxTaskAction(share)),
      acknowledge: (id) => plugin.acknowledge({ id }),
    };
    const { invalid } = await this._importer.importPending(source);
    if (invalid > 0) {
      throw new Error(CAPTURE_IMPORT_ERR.INVALID_ENTRY);
    }
  }
}

const addInboxTaskAction = (
  share: IosShare,
): ReturnType<typeof TaskSharedActions.addTask> =>
  TaskSharedActions.addTask({
    task: {
      ...DEFAULT_TASK,
      id: share.id,
      title: (share.title.trim() || share.text.trim().split('\n')[0]).slice(0, 300),
      notes: share.text,
      projectId: INBOX_PROJECT.id,
      created: Date.now(),
    },
    workContextId: INBOX_PROJECT.id,
    workContextType: WorkContextType.PROJECT,
    isAddToBacklog: false,
    isAddToBottom: true,
    isIgnoreShortSyntax: true,
  });
