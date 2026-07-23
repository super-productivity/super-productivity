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

  isShowInner: boolean = false;
  readonly isOpen = signal(false);
  private _restoreFocusTo?: HTMLElement;

  readonly taskContextMenuInner = viewChild('taskContextMenuInner', {
    read: TaskContextMenuInnerComponent,
  });

  open(
    ev?: MouseEvent | KeyboardEvent | TouchEvent,
    isOpenedFromKeyBoard = false,
    restoreFocusTo?: HTMLElement,
  ): void {
    this.isShowInner = true;
    this.isOpen.set(true);
    this._restoreFocusTo = restoreFocusTo;
    this._cd.detectChanges();
    this.taskContextMenuInner()?.open(ev, isOpenedFromKeyBoard);
  }

  onClose(): void {
    this.isShowInner = false;
    this.isOpen.set(false);

    const restoreFocusTo = this._restoreFocusTo;
    this._restoreFocusTo = undefined;
    if (restoreFocusTo) {
      setTimeout(() => {
        if (restoreFocusTo.isConnected) {
          restoreFocusTo.focus({ preventScroll: true });
        }
      });
    }
  }
}
