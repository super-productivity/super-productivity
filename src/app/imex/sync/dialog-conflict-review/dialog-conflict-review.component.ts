/**
 * SPAP-16 — Blocking per-item merge review dialog (SPAP-12 mockup 3).
 *
 * Opened from `_handleLocalDataConflict` when the user chooses "REVIEW N
 * DIFFERENCES". Shows three sections — Changed on both / Only on this device /
 * Only on server — with per-item picks (preselected newest-wins for the
 * differing set) plus bulk bars. Reuses the SPAP-15 field-value `display()`
 * rendering approach. Closing:
 *  - APPLY  → returns `{ picks }`; the wrapper performs the merge+upload.
 *  - CANCEL → returns `undefined`; the wrapper re-opens the 3-button dialog with
 *             the conflict still unresolved (sync stays paused).
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import {
  DifferingEntity,
  OnlySideEntity,
  WholeDatasetDiff,
} from '../../../op-log/sync/whole-dataset-diff.util';
import {
  buildDefaultPicks,
  DifferingPick,
  MergePicks,
  OnlyLocalPick,
  OnlyRemotePick,
  pickKey,
} from '../../../op-log/sync/whole-dataset-merge.util';

export interface ConflictReviewDialogData {
  diff: WholeDatasetDiff;
}

export type ConflictReviewResult = { picks: MergePicks } | undefined;

@Component({
  selector: 'dialog-conflict-review',
  templateUrl: './dialog-conflict-review.component.html',
  styleUrls: ['./dialog-conflict-review.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
  ],
})
export class DialogConflictReviewComponent {
  private _matDialogRef =
    inject<MatDialogRef<DialogConflictReviewComponent, ConflictReviewResult>>(
      MatDialogRef,
    );
  data = inject<ConflictReviewDialogData>(MAT_DIALOG_DATA);

  T: typeof T = T;

  readonly differing: readonly DifferingEntity[] = this.data.diff.differing;
  readonly onlyLocal: readonly OnlySideEntity[] = this.data.diff.onlyLocal;
  readonly onlyRemote: readonly OnlySideEntity[] = this.data.diff.onlyRemote;

  readonly hasAny =
    this.differing.length > 0 || this.onlyLocal.length > 0 || this.onlyRemote.length > 0;

  // Pick state — initialised to the newest-wins / keep / add defaults.
  private readonly _differingPicks = signal<Record<string, DifferingPick>>({});
  private readonly _onlyLocalPicks = signal<Record<string, OnlyLocalPick>>({});
  private readonly _onlyRemotePicks = signal<Record<string, OnlyRemotePick>>({});

  readonly applying = signal(false);

  constructor() {
    this._matDialogRef.disableClose = true;
    const defaults = buildDefaultPicks(this.data.diff);
    this._differingPicks.set(defaults.differing);
    this._onlyLocalPicks.set(defaults.onlyLocal);
    this._onlyRemotePicks.set(defaults.onlyRemote);
  }

  key(e: DifferingEntity | OnlySideEntity): string {
    return pickKey(e.modelKey, e.entityId);
  }

  // ── Differing picks ─────────────────────────────────────────────────────────
  differingPick(e: DifferingEntity): DifferingPick {
    return this._differingPicks()[this.key(e)] ?? 'local';
  }

  setDiffering(e: DifferingEntity, pick: DifferingPick): void {
    this._differingPicks.update((m) => ({ ...m, [this.key(e)]: pick }));
  }

  setAllDiffering(pick: DifferingPick): void {
    this._differingPicks.update((m) => {
      const next = { ...m };
      for (const e of this.differing) {
        next[this.key(e)] = pick;
      }
      return next;
    });
  }

  // ── Only-local picks ─────────────────────────────────────────────────────────
  onlyLocalPick(e: OnlySideEntity): OnlyLocalPick {
    return this._onlyLocalPicks()[this.key(e)] ?? 'keep';
  }

  setOnlyLocal(e: OnlySideEntity, pick: OnlyLocalPick): void {
    this._onlyLocalPicks.update((m) => ({ ...m, [this.key(e)]: pick }));
  }

  setAllOnlyLocal(pick: OnlyLocalPick): void {
    this._onlyLocalPicks.update((m) => {
      const next = { ...m };
      for (const e of this.onlyLocal) {
        next[this.key(e)] = pick;
      }
      return next;
    });
  }

  // ── Only-remote picks ────────────────────────────────────────────────────────
  onlyRemotePick(e: OnlySideEntity): OnlyRemotePick {
    return this._onlyRemotePicks()[this.key(e)] ?? 'add';
  }

  setOnlyRemote(e: OnlySideEntity, pick: OnlyRemotePick): void {
    this._onlyRemotePicks.update((m) => ({ ...m, [this.key(e)]: pick }));
  }

  setAllOnlyRemote(pick: OnlyRemotePick): void {
    this._onlyRemotePicks.update((m) => {
      const next = { ...m };
      for (const e of this.onlyRemote) {
        next[this.key(e)] = pick;
      }
      return next;
    });
  }

  readonly picks = computed<MergePicks>(() => ({
    differing: this._differingPicks(),
    onlyLocal: this._onlyLocalPicks(),
    onlyRemote: this._onlyRemotePicks(),
  }));

  /** Human-readable rendering of a captured field value (mirrors SPAP-15). */
  display(val: unknown): string {
    if (val === null || val === undefined) {
      return '—';
    }
    if (typeof val === 'string') {
      return val;
    }
    if (typeof val === 'number' || typeof val === 'boolean') {
      return String(val);
    }
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }

  cancel(): void {
    this._matDialogRef.close(undefined);
  }

  apply(): void {
    // Snapshot the picks; the wrapper runs the actual merge+upload.
    this.applying.set(true);
    this._matDialogRef.close({ picks: this.picks() });
  }
}
