import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { TranslatePipe } from '@ngx-translate/core';
import { from } from 'rxjs';
import { SyncLog } from '../../../core/log';
import { StateSnapshotService } from '../../../op-log/backup/state-snapshot.service';
import { T } from '../../../t.const';
import { countAllTasks } from '../../local-backup/backup-ring.util';
import { DialogConflictResolutionResult } from '../sync.model';

/**
 * From this many tasks on this device, keeping the account's tasks gets the
 * strong warning. Higher than the recovery banner's threshold
 * (`isSuspiciousShrink`) on purpose: that banner is a quiet hint after the
 * fact, this warning blocks a choice, so it is meant only for big losses.
 */
export const BIG_LOSS_MIN_TASKS = 10;

type FirstSyncChoice = Exclude<DialogConflictResolutionResult, false>;

/**
 * Whether a choice gets the strong warning. Replacing the account always does:
 * SuperSync can't count the account's tasks before downloading them, so its
 * loss can't be measured.
 */
export const isBigLoss = (choice: FirstSyncChoice, deviceTaskCount: number): boolean =>
  choice === 'USE_LOCAL' || deviceTaskCount >= BIG_LOSS_MIN_TASKS;

/**
 * The local-data choice when a device that already has tasks joins a SuperSync
 * account for the first time (2b, mockups v3). Emits the choice; the conflict
 * dialog closes with it.
 */
@Component({
  selector: 'sync-first-choice',
  templateUrl: './sync-first-choice.component.html',
  styleUrls: ['./sync-first-choice.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButton,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    MatIcon,
    MatRadioButton,
    MatRadioGroup,
    TranslatePipe,
  ],
})
export class SyncFirstChoiceComponent {
  private _stateSnapshotService = inject(StateSnapshotService);

  readonly chosen = output<FirstSyncChoice | undefined>();
  readonly T = T;

  /** `null` until counted; nothing can be chosen until then. */
  readonly taskCount = toSignal(from(this._countTasks()), { initialValue: null });
  readonly isUseAccountRecommended = computed(() => {
    const count = this.taskCount();
    return count !== null && !isBigLoss('USE_REMOTE', count);
  });
  // Preselect the safe choice only when nothing big is at stake.
  readonly choice = linkedSignal<FirstSyncChoice | null>(() =>
    this.isUseAccountRecommended() ? 'USE_REMOTE' : null,
  );
  readonly isBigLoss = computed(() => {
    const choice = this.choice();
    const count = this.taskCount();
    return choice !== null && count !== null && isBigLoss(choice, count);
  });
  readonly warningKey = computed(() =>
    this.choice() === 'USE_LOCAL'
      ? T.F.SYNC.D_FIRST_SYNC.WARN_REPLACE_ACCOUNT
      : T.F.SYNC.D_FIRST_SYNC.WARN_REMOVE_DEVICE_TASKS,
  );
  readonly submitKey = computed(() => {
    if (!this.isBigLoss()) {
      return T.F.SYNC.D_FIRST_SYNC.CONTINUE;
    }
    return this.choice() === 'USE_LOCAL'
      ? T.F.SYNC.D_FIRST_SYNC.REMOVE_ACCOUNT_TASKS
      : T.F.SYNC.D_FIRST_SYNC.REMOVE_DEVICE_TASKS;
  });

  submit(): void {
    const choice = this.choice();
    if (choice) {
      this.chosen.emit(choice);
    }
  }

  // Counted like the backups list counts them (archives included), so the
  // number here matches the backup it can be restored from.
  private async _countTasks(): Promise<number> {
    try {
      return countAllTasks(await this._stateSnapshotService.getStateSnapshotAsync());
    } catch (e) {
      SyncLog.err('SyncFirstChoiceComponent: counting archived tasks failed', e);
      return countAllTasks(this._stateSnapshotService.getStateSnapshot());
    }
  }
}
