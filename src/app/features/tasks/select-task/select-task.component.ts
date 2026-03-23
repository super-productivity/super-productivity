import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  Input,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormControl } from '@angular/forms';
import { Task } from '../task.model';
import { combineLatest } from 'rxjs';
import { startWith, switchMap } from 'rxjs/operators';
import { T } from '../../../t.const';
import { WorkContextService } from '../../work-context/work-context.service';
import { Store } from '@ngrx/store';
import {
  selectStartableTasksActiveContextFirst,
  selectTrackableTasksActiveContextFirst,
} from '../../work-context/store/work-context.selectors';
import { Project } from '../../project/project.model';
import { selectAllProjects } from '../../project/store/project.selectors';
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import {
  MatAutocomplete,
  MatAutocompleteSelectedEvent,
  MatAutocompleteTrigger,
} from '@angular/material/autocomplete';
import { MatIcon } from '@angular/material/icon';
import { MatOption } from '@angular/material/core';
import { TranslatePipe } from '@ngx-translate/core';
import { IssueIconPipe } from '../../issue/issue-icon/issue-icon.pipe';
import { TagComponent } from '../../tag/tag/tag.component';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'select-task',
  templateUrl: './select-task.component.html',
  styleUrls: ['./select-task.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatFormField,
    MatLabel,
    MatInput,
    FormsModule,
    MatAutocompleteTrigger,
    ReactiveFormsModule,
    MatIcon,
    MatSuffix,
    MatAutocomplete,
    MatOption,
    TranslatePipe,
    IssueIconPipe,
    TagComponent,
  ],
})
export class SelectTaskComponent {
  private readonly _workContextService = inject(WorkContextService);
  private readonly _store = inject(Store);

  T: typeof T = T;
  readonly taskSelectCtrl: UntypedFormControl = new UntypedFormControl('');
  readonly taskChange = output<Task | string>();
  readonly isLimitToProject = input<boolean>(false);
  readonly isIncludeDoneTasks = input<boolean>(false);
  readonly isShowSuggestionsWithoutSearch = input<boolean>(false);

  @ViewChild(MatAutocompleteTrigger)
  autocompleteTrigger?: MatAutocompleteTrigger;

  private readonly _projects = toSignal(this._store.select(selectAllProjects), {
    initialValue: [] as Project[],
  });

  private readonly _tasks = toSignal(
    combineLatest([
      toObservable(this.isLimitToProject),
      toObservable(this.isIncludeDoneTasks),
    ]).pipe(
      switchMap(([isLimitToProject, isIncludeDoneTasks]) =>
        isLimitToProject
          ? isIncludeDoneTasks
            ? this._workContextService.trackableTasksForActiveContext$
            : this._workContextService.startableTasksForActiveContext$
          : isIncludeDoneTasks
            ? this._store.select(selectTrackableTasksActiveContextFirst)
            : this._store.select(selectStartableTasksActiveContextFirst),
      ),
    ),
    { initialValue: [] as Task[] },
  );

  private readonly _isPanelOpen = signal<boolean>(false);

  private readonly _taskOrTitle = toSignal<Task | string | null>(
    this.taskSelectCtrl.valueChanges.pipe(startWith(this.taskSelectCtrl.value ?? null)),
    { requireSync: true },
  );

  readonly projectMap = computed(() => {
    const projectLookup: { [key: string]: Project } = {};
    for (const project of this._projects()) {
      projectLookup[project.id] = project;
    }
    return projectLookup;
  });

  readonly filteredTasks = computed(() => {
    const taskOrTitle = this._taskOrTitle();
    if (typeof taskOrTitle === 'string') {
      const searchTerm = taskOrTitle.trim().toLowerCase();
      if (!searchTerm && !this.isShowSuggestionsWithoutSearch()) {
        return [];
      }

      if (!searchTerm) {
        return this._tasks();
      }

      return this._tasks().filter((task) =>
        task.title?.toLowerCase().includes(searchTerm),
      );
    }
    return [];
  });

  readonly isCreate = computed(() => {
    if (this._isPanelOpen() && this.filteredTasks().length > 0) {
      return false;
    }
    const taskOrTitle = this._taskOrTitle();
    return typeof taskOrTitle === 'string' && taskOrTitle.trim().length > 0;
  });

  constructor() {
    effect(() => {
      const taskOrTitle = this._taskOrTitle();
      if (taskOrTitle === null) {
        this.taskChange.emit('');
      } else {
        this.taskChange.emit(taskOrTitle);
      }
    });
  }

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input() set initialTask(task: Task) {
    if (task) {
      const currentValue = this.taskSelectCtrl.value;
      const currentTaskId =
        currentValue && typeof currentValue === 'object'
          ? (currentValue as Task).id
          : null;
      if (currentTaskId !== task.id) {
        this.taskSelectCtrl.setValue(task);
      }
    } else if (this.taskSelectCtrl.value) {
      this.taskSelectCtrl.setValue('');
    }
  }

  displayWith(task?: Task): string | undefined {
    // NOTE: apparently task can be undefined for displayWith
    return task?.title;
  }

  onOptionSelected(event: MatAutocompleteSelectedEvent): void {
    const selectedTask = event.option.value as Task;
    if (selectedTask) {
      if (this.taskSelectCtrl.value !== selectedTask) {
        this.taskSelectCtrl.setValue(selectedTask);
      }
      this._isPanelOpen.set(false);
    }
  }

  onPanelClosed(): void {
    this._isPanelOpen.set(false);
  }

  onPanelOpened(): void {
    this._isPanelOpen.set(true);
  }

  trackById(i: number, task: Task): string {
    return task.id;
  }

  openPanel(): void {
    if (this.autocompleteTrigger && !this.autocompleteTrigger.panelOpen) {
      this.autocompleteTrigger.openPanel();
    }
  }

  isInCreateMode(): boolean {
    return this.isCreate();
  }
}
