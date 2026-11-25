import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { Task } from '../task.model';

/**
 * The drag preview of a selected group: its size and titles, in drop order.
 * Styled in src/styles/components/_task-group-drag-preview.scss.
 */
@Component({
  selector: 'task-group-drag-preview',
  templateUrl: './task-group-drag-preview.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'multi-task-drag-preview' },
})
export class TaskGroupDragPreviewComponent {
  readonly count = input.required<number>();
  readonly tasks = input.required<readonly Task[]>();
  protected readonly T = T;
}
