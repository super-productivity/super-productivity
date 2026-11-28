import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  DOCUMENT,
  ElementRef,
  inject,
  Injector,
  input,
  OnChanges,
  output,
  signal,
  SimpleChanges,
  viewChildren,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { PlainspaceSharedTask } from '../plainspace-shared-task.model';
import { PlainspaceClaimPoolService } from '../plainspace-claim-pool.service';

/**
 * Remote previews in the project task list. Only unassigned tasks offer Claim.
 * Personal task actions become available after a successful import.
 */
@Component({
  selector: 'plainspace-claim-pool',
  templateUrl: './claim-pool.component.html',
  styleUrls: ['./claim-pool.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatButton, MatProgressSpinner, MatTooltip, TranslatePipe],
})
export class PlainspaceClaimPoolComponent implements OnChanges {
  readonly T = T;
  readonly tasks = input<PlainspaceSharedTask[]>([]);
  readonly projectId = input<string>('');
  readonly claimed = output<string>();
  readonly focusList = output<void>();
  readonly openLocalCopy = output<string>();

  private readonly _claimButtons = viewChildren('claimButton', {
    read: ElementRef<HTMLButtonElement>,
  });
  private readonly _document = inject(DOCUMENT);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);

  private readonly _destroyRef = inject(DestroyRef);
  private _claimPoolService = inject(PlainspaceClaimPoolService);
  readonly claimingIds = signal<ReadonlySet<string>>(new Set());

  ngOnChanges(changes: SimpleChanges<PlainspaceClaimPoolComponent>): void {
    if (!changes.tasks || changes.projectId) {
      return;
    }
    const focused = this._document.activeElement;
    const focusedRow = focused?.closest('.claim-task');
    if (!focused || !focusedRow || !this._host.nativeElement.contains(focusedRow)) {
      return;
    }
    const before = this._claimButtons();
    const index = before.findIndex((button) => focusedRow.contains(button.nativeElement));
    const projectId = this.projectId();

    // Read the old position before Angular reconciles the rows. A surviving
    // control or a user who moved focus while waiting needs no intervention.
    afterNextRender(
      () => {
        if (
          this.projectId() !== projectId ||
          focused.isConnected ||
          this._document.activeElement !== this._document.body
        ) {
          return;
        }
        const neighbors =
          index < 0
            ? before
            : [...before.slice(index + 1), ...before.slice(0, index).reverse()];
        const next =
          neighbors.find((button) => button.nativeElement.isConnected) ??
          this._claimButtons()[0];
        if (next) {
          next.nativeElement.focus();
        } else {
          this.focusList.emit();
        }
      },
      { injector: this._injector },
    );
  }

  async claim(task: PlainspaceSharedTask): Promise<void> {
    const projectId = this.projectId();
    if (!projectId || task.isMine || task.assignee || this.claimingIds().has(task.id)) {
      return;
    }
    this._setClaiming(task.id, true);
    try {
      const taskId = await this._claimPoolService.claim(projectId, task.id);
      if (taskId && !this._destroyRef.destroyed && this.projectId() === projectId) {
        this.claimed.emit(taskId);
      }
    } finally {
      this._setClaiming(task.id, false);
    }
  }

  private _setClaiming(id: string, isClaiming: boolean): void {
    this.claimingIds.update((set) => {
      const next = new Set(set);
      if (isClaiming) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }
}
