import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { SelectTaskComponent } from '../../tasks/select-task/select-task.component';
import { Task } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { MatMiniFabButton } from '@angular/material/button';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'focus-mode-task-selector',
  templateUrl: './focus-mode-task-selector.component.html',
  styleUrls: ['./focus-mode-task-selector.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [fadeAnimation],
  imports: [SelectTaskComponent, MatIcon, MatMiniFabButton],
})
export class FocusModeTaskSelectorComponent implements AfterViewInit {
  private readonly _taskService = inject(TaskService);

  readonly taskSelected = output<string>();
  readonly closed = output<void>();

  currentTaskInputText = signal<string>('');

  @ViewChild(SelectTaskComponent, { read: ElementRef })
  selectTaskElementRef?: ElementRef;
  @ViewChild(SelectTaskComponent)
  selectTaskComponent?: SelectTaskComponent;

  private inputElement?: HTMLInputElement;

  ngAfterViewInit(): void {
    requestAnimationFrame(() => {
      this.inputElement =
        this.selectTaskElementRef?.nativeElement?.querySelector('input');
      this.inputElement?.focus();
      this.selectTaskComponent?.openPanel();
    });
  }

  onTaskChange(taskOrString: Task | string | null): void {
    // Track text input for later use
    if (typeof taskOrString === 'string') {
      this.currentTaskInputText.set(taskOrString);
      return; // Don't create task yet - wait for Enter or button click
    }

    // Task object selected from autocomplete
    if (taskOrString && typeof taskOrString === 'object') {
      this.currentTaskInputText.set('');
      this.taskSelected.emit(taskOrString.id);
    }
  }

  @HostListener('keydown.enter', ['$event'])
  handleEnter(event: KeyboardEvent): void {
    if (this.selectTaskComponent?.isInCreateMode()) {
      event.preventDefault();
      this.createAndSelectTaskFromInput();
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    // Only handle Escape to close the task selector
    // Let the autocomplete and input handle all other keys naturally
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();
    }
  }

  createAndSelectTaskFromInput(): void {
    const taskTitle = this.currentTaskInputText().trim();
    if (taskTitle) {
      const newTaskId = this._taskService.add(taskTitle, false, {});
      this.taskSelected.emit(newTaskId);
      this.currentTaskInputText.set('');
    }
  }

  close(): void {
    this.closed.emit();
  }
}
