import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { PlainspaceSharedTask } from '../plainspace-shared-task.model';
import { PlainspaceClaimPoolService } from '../plainspace-claim-pool.service';

/**
 * Read-only list of unclaimed Plainspace tasks for a shared project, each with a
 * "Claim" action. Claiming assigns the task to me in Plainspace and imports it
 * as a first-class SP task; the claimed task then leaves the pool.
 *
 * Deliberately a lightweight, standalone component (not the hot-path
 * `TaskComponent`): these are foreign tasks until claimed and must never be
 * edited/scheduled or written into the SP task store. See
 * docs/plainspace-integration-plan.md.
 */
@Component({
  selector: 'plainspace-claim-pool',
  templateUrl: './claim-pool.component.html',
  styleUrls: ['./claim-pool.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatButton, MatIconButton, MatTooltip, TranslatePipe],
})
export class PlainspaceClaimPoolComponent {
  readonly T = T;
  readonly tasks = input<PlainspaceSharedTask[]>([]);
  readonly projectId = input<string>('');

  private _claimPoolService = inject(PlainspaceClaimPoolService);
  readonly claimingIds = signal<ReadonlySet<string>>(new Set());

  async claim(task: PlainspaceSharedTask): Promise<void> {
    const projectId = this.projectId();
    if (!projectId || this.claimingIds().has(task.id)) {
      return;
    }
    this._setClaiming(task.id, true);
    try {
      await this._claimPoolService.claim(projectId, task.id);
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
