import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { Task } from '../../tasks/task.model';
import { IssueSyncStateService } from '../two-way-sync/issue-sync-state.service';

/**
 * The task's two-way-sync state in its issue section of the detail panel
 * (never in the task row, a hot path): "no longer in your Plainspace list"
 * after a successful poll did not return it, or "couldn't sync" with the
 * reason of the last failed push and a Retry that pushes its pending edits.
 */
@Component({
  selector: 'issue-sync-state',
  templateUrl: './issue-sync-state.component.html',
  styleUrls: ['./issue-sync-state.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatIcon, TranslatePipe],
})
export class IssueSyncStateComponent {
  private readonly _syncState = inject(IssueSyncStateService);

  readonly T = T;
  readonly task = input.required<Pick<Task, 'id'>>();
  readonly isMissing = computed(() =>
    this._syncState.missingTaskIds().has(this.task().id),
  );
  readonly failure = computed(() => this._syncState.failures().get(this.task().id));
  readonly reasonKey = computed(() => {
    const failure = this.failure();
    return failure && 'msgKey' in failure ? failure.msgKey : null;
  });
  readonly reasonText = computed(() => {
    const failure = this.failure();
    return failure && 'text' in failure ? failure.text : '';
  });

  retry(): void {
    this._syncState.requestPush(this.task().id, false);
  }
}
