import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { Task } from '../../tasks/task.model';
import { SimpleCounter } from '../simple-counter.model';
import { computed, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { selectAllTasks } from '../../tasks/store/task.selectors';
import { T } from '../../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule, ReactiveFormsModule, UntypedFormControl } from '@angular/forms';
import { MatAutocomplete, MatOption } from '@angular/material/autocomplete';
import { MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { startWith } from 'rxjs/operators';

export interface DialogSelectHabitTaskData {
  simpleCounter: SimpleCounter;
}

@Component({
  selector: 'dialog-select-habit-task',
  standalone: true,
  imports: [
    MatButton,
    TranslatePipe,
    MatFormField,
    MatLabel,
    MatInput,
    FormsModule,
    ReactiveFormsModule,
    MatAutocomplete,
    MatOption,
    MatAutocompleteTrigger,
  ],
  template: `
    <div class="dialog-wrapper">
      <h2 mat-dialog-title>{{ data.simpleCounter.title }}</h2>
      <div mat-dialog-content>
        <p>{{ T.F.SIMPLE_COUNTER.DIALOG_SELECT_TASK.DESCRIPTION | translate }}</p>

        <mat-form-field class="full-width">
          <mat-label>{{ T.F.TASK.SELECT_OR_CREATE | translate }}</mat-label>
          <input
            [formControl]="taskSelectCtrl"
            [matAutocomplete]="auto"
            matInput
            cdkFocusInitial
            autofocus="autofocus"
          />
          <mat-autocomplete
            #auto="matAutocomplete"
            [autoActiveFirstOption]="true"
            [displayWith]="displayWith"
            (optionSelected)="onTaskSelected($event)"
          >
            @for (task of displayedTasks(); track task.id) {
              <mat-option [value]="task">
                {{ task.title }}
              </mat-option>
            }
            @if (displayedTasks().length === 0) {
              <mat-option
                [value]="null"
                [disabled]="true"
              >
                {{ T.F.SIMPLE_COUNTER.DIALOG_SELECT_TASK.NO_MATCHING_TASKS | translate }}
              </mat-option>
            }
          </mat-autocomplete>
        </mat-form-field>
      </div>
      <div
        mat-dialog-actions
        align="end"
      >
        <button
          mat-button
          (click)="cancel()"
        >
          {{ T.F.SIMPLE_COUNTER.DIALOG_SELECT_TASK.CANCEL | translate }}
        </button>
        <button
          mat-raised-button
          color="primary"
          [disabled]="!selectedTask()"
          (click)="confirm()"
        >
          {{ T.F.SIMPLE_COUNTER.DIALOG_SELECT_TASK.START_TRACKING | translate }}
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .dialog-wrapper {
        padding: 16px;
        min-width: 400px;
      }

      [mat-dialog-content] {
        padding: 20px 0;
      }

      [mat-dialog-actions] {
        margin-top: 16px;
      }

      .full-width {
        width: 100%;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogSelectHabitTaskComponent {
  private _dialogRef = inject(MatDialogRef<DialogSelectHabitTaskComponent>);
  private _store = inject(Store);

  T: typeof T = T;
  data = inject<DialogSelectHabitTaskData>(MAT_DIALOG_DATA);
  selectedTask = signal<Task | null>(null);
  taskSelectCtrl: UntypedFormControl = new UntypedFormControl('');

  // Get all tasks
  private _allTasks = toSignal(this._store.select(selectAllTasks), {
    initialValue: [] as Task[],
  });

  // Filter tasks based on habit configuration
  private _filteredTasks = computed(() => {
    const counter = this.data.simpleCounter;
    const tasks = this._allTasks();

    // Filter out done tasks
    const activeTasks = tasks.filter((task) => !task.isDone);

    if (!counter.enableAutoTrackFromTasks) {
      return activeTasks;
    }

    // If no linked tags/projects configured, show all tasks
    const hasLinkedTags = counter.linkedTagIds && counter.linkedTagIds.length > 0;
    const hasLinkedProjects =
      counter.linkedProjectIds && counter.linkedProjectIds.length > 0;

    if (!hasLinkedTags && !hasLinkedProjects) {
      return activeTasks;
    }

    return activeTasks.filter((task) => {
      // Exclude tasks with excluded tags
      if (counter.excludedTagIds && counter.excludedTagIds.length > 0) {
        if (task.tagIds.some((tagId) => counter.excludedTagIds!.includes(tagId))) {
          return false;
        }
      }

      // Exclude tasks with excluded project
      if (
        counter.excludedProjectIds &&
        counter.excludedProjectIds.length > 0 &&
        task.projectId &&
        counter.excludedProjectIds.includes(task.projectId)
      ) {
        return false;
      }

      // Check if task has linked tags or projects
      const hasLinkedTag =
        hasLinkedTags &&
        task.tagIds.some((tagId) => counter.linkedTagIds!.includes(tagId));

      const hasLinkedProject =
        hasLinkedProjects &&
        task.projectId &&
        counter.linkedProjectIds!.includes(task.projectId);

      return hasLinkedTag || hasLinkedProject;
    });
  });

  // Search input value
  private _searchTerm = toSignal(this.taskSelectCtrl.valueChanges.pipe(startWith('')), {
    initialValue: '',
  });

  // Displayed tasks based on search
  displayedTasks = computed(() => {
    const searchTerm = this._searchTerm();
    const filtered = this._filteredTasks();

    if (typeof searchTerm === 'string' && searchTerm.trim()) {
      const search = searchTerm.toLowerCase();
      return filtered.filter((task) => task.title.toLowerCase().includes(search));
    }

    return filtered;
  });

  displayWith(task?: Task): string | undefined {
    return task?.title;
  }

  onTaskSelected(event: any): void {
    const task = event.option.value as Task;
    if (task) {
      this.selectedTask.set(task);
    }
  }

  cancel(): void {
    this._dialogRef.close(null);
  }

  confirm(): void {
    const task = this.selectedTask();
    if (task) {
      this._dialogRef.close(task);
    }
  }
}
