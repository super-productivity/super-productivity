import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
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

/** "Vastly more": this device needs at least this many times the account's tasks. */
const MUCH_BIGGER_FACTOR = 2;

type FirstSyncChoice = Exclude<DialogConflictResolutionResult, false>;

/**
 * Whether a choice gets the strong warning. Replacing the account always does:
 * its count comes from its last snapshot, which misses later tasks, so a small
 * count doesn't prove a small loss. Keeping the account's tasks warns when this
 * device has many tasks, and, if the account was counted, at least twice as many.
 */
export const isBigLoss = (
  choice: FirstSyncChoice,
  deviceTaskCount: number,
  accountTaskCount?: number,
): boolean =>
  choice === 'USE_LOCAL' ||
  (deviceTaskCount >= BIG_LOSS_MIN_TASKS &&
    (accountTaskCount === undefined ||
      deviceTaskCount >= accountTaskCount * MUCH_BIGGER_FACTOR));

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

  /** Tasks in the account's last snapshot, when known. */
  readonly accountTaskCount = input<number | undefined>();
  readonly chosen = output<FirstSyncChoice | undefined>();
  readonly T = T;

  /** `null` until counted; nothing can be chosen until then. */
  readonly taskCount = toSignal(from(this._countTasks()), { initialValue: null });
  readonly isUseAccountRecommended = computed(() => {
    const count = this.taskCount();
    return count !== null && !isBigLoss('USE_REMOTE', count, this.accountTaskCount());
  });
  // Preselect the safe choice only when nothing big is at stake.
  readonly choice = linkedSignal<FirstSyncChoice | null>(() =>
    this.isUseAccountRecommended() ? 'USE_REMOTE' : null,
  );
  readonly isBigLoss = computed(() => {
    const choice = this.choice();
    const count = this.taskCount();
    return (
      choice !== null &&
      count !== null &&
      isBigLoss(choice, count, this.accountTaskCount())
    );
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
