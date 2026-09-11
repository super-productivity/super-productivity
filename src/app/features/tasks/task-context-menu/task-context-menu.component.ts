import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  input,
  signal,
  viewChild,
  inject,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { Task, TaskWithSubTasks } from '../task.model';
import { TaskContextMenuInnerComponent } from './task-context-menu-inner/task-context-menu-inner.component';

@Component({
  selector: 'task-context-menu',
  imports: [TranslateModule, TaskContextMenuInnerComponent],
  templateUrl: './task-context-menu.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskContextMenuComponent {
  private _cd = inject(ChangeDetectorRef);

  task = input.required<TaskWithSubTasks | Task>();
  isAdvancedControls = input<boolean>(false);

  readonly isOpen = signal(false);

  readonly taskContextMenuInner = viewChild('taskContextMenuInner', {
    read: TaskContextMenuInnerComponent,
  });

  open(
    ev?: MouseEvent | KeyboardEvent | TouchEvent,
    isOpenedFromKeyBoard = false,
    restoreFocusTo?: HTMLElement,
  ): void {
    this.isOpen.set(true);
    this._cd.detectChanges();
    this.taskContextMenuInner()?.open(ev, isOpenedFromKeyBoard, restoreFocusTo);
  }

  onClose(): void {
    this.isOpen.set(false);
  }
}
