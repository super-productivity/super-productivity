import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  HostBinding,
  HostListener,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  Signal,
  viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TaskService } from '../../tasks/task.service';
import { Task } from '../../tasks/task.model';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { PlannerActions } from '../../planner/store/planner.actions';
import { Store } from '@ngrx/store';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { ShortTimeHtmlPipe } from '../../../ui/pipes/short-time-html.pipe';
import { SelectTaskMinimalComponent } from '../../tasks/select-task/select-task-minimal/select-task-minimal.component';
import { devError } from '../../../util/dev-error';
import { SnackService } from '../../../core/snack/snack.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';

type Timeout = NodeJS.Timeout | number | undefined;

@Component({
  selector: 'create-task-placeholder',
  imports: [MatIcon, LocaleDatePipe, ShortTimeHtmlPipe, SelectTaskMinimalComponent],
  templateUrl: './create-task-placeholder.component.html',
  styleUrl: './create-task-placeholder.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateTaskPlaceholderComponent implements OnDestroy {
  private _taskService = inject(TaskService);
  private _store = inject(Store);
  private readonly _snackService = inject(SnackService);
  private readonly _globalConfigService = inject(GlobalConfigService);

  isEditMode = input.required<boolean>();
  time = input<string>();
  date = input<string>();

  // Task selection state
  selectedTask = signal<Task | null>(null);
  newTaskTitle = signal<string>('');
  isCreate = signal<boolean>(false);
  isForDayMode = signal<boolean>(false);
  due: Signal<number> = computed(() => {
    if (this.date() && this.time()) {
      // Log.log(this.date(), this.time());
      const formattedTime = this._formatTimeWithLeadingZero(this.time() as string);
      return new Date(`${this.date()}T${formattedTime}`).getTime();
    }
    return 0;
  });

  editEnd = output<void>();

  readonly selectTaskMinimal = viewChild('selectTaskMinimal', { read: ElementRef });

  private _interactionState: 'Idle' | 'Editing' | 'Selecting' = 'Idle';
  private _blurTimeout: Timeout;
  private _selectionTimeout: Timeout;

  // Timeout constants for better maintainability
  private readonly BLUR_DELAY = 150;
  private readonly SELECTION_DELAY = 100;

  @HostBinding('class.edit-mode')
  get isEditModeClass(): boolean {
    return this.isEditMode();
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    event.stopPropagation();
    this._setState('Editing');
    this._focusSelectTaskMinimal();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.isEditMode()) {
      const target = event.target as HTMLElement;
      const component = target.closest('create-task-placeholder');
      const autocompleteOption = target.closest('mat-option');

      // If click is outside the component and not on an autocomplete option, close it
      if (!component && !autocompleteOption) {
        this._closeAndReset();
      }
    }
  }

  constructor() {
    effect(() => {
      if (this.isEditMode()) {
        this._focusSelectTaskMinimal();
      }
    });
  }

  ngOnDestroy(): void {
    this._clearTimeouts();
    this.editEnd.emit();
  }
  onTaskChange(taskOrTaskTitle: Task | string): void {
    this.isCreate.set(typeof taskOrTaskTitle === 'string');

    if (this.isCreate()) {
      // New task creation
      this.newTaskTitle.set(taskOrTaskTitle as string);
      this.selectedTask.set(null);
    } else {
      // Existing task selection
      this.selectedTask.set(taskOrTaskTitle as Task);
      this.newTaskTitle.set('');
    }
  }

  async onTaskSelected(task: Task): Promise<void> {
    this._setState('Selecting');
    this.selectedTask.set(task);
    this.newTaskTitle.set('');
    this.isCreate.set(false);

    if (this.due()) {
      await this.addTask();
      this._closeAndReset();
    } else {
      this._setState('Idle');
    }
  }

  onTextChanged(text: string): void {
    this.isCreate.set(true);
    this.newTaskTitle.set(text);
    this.selectedTask.set(null);
  }

  onSimpleTaskInputBlur(): void {
    this._clearTimeouts();
    // Only close if we're in idle state (not editing autocomplete or selecting)
    if (this._interactionState === 'Idle') {
      this._blurTimeout = window.setTimeout(() => this._closeAndReset(), this.BLUR_DELAY);
    }
  }

  private _clearTimeouts(): void {
    window.clearTimeout(this._blurTimeout);
    window.clearTimeout(this._selectionTimeout);
  }

  private _resetTaskState(): void {
    this.newTaskTitle.set('');
    this.selectedTask.set(null);
    this.isCreate.set(false);
  }

  private _setState(state: 'Idle' | 'Editing' | 'Selecting'): void {
    this._interactionState = state;
    if (state === 'Editing') {
      this._clearTimeouts();
    }
  }

  private _closeAndReset(): void {
    this._clearTimeouts();
    this._resetTaskState();
    this._setState('Idle');
    this.editEnd.emit();
  }

  onAutocompleteOpened(): void {
    this._setState('Editing');
  }

  onAutocompleteClosed(): void {
    // Add a small delay to ensure option selection is processed first
    this._selectionTimeout = setTimeout(() => {
      if (this._interactionState !== 'Selecting') {
        this._setState('Idle');
      }
    }, this.SELECTION_DELAY);
  }

  async onSelectTaskKeyDown(event: KeyboardEvent): Promise<void> {
    if (
      event.key === 'Enter' &&
      this.due() &&
      (this.selectedTask() || this.newTaskTitle())
    ) {
      await this.addTask();
      this._closeAndReset();
    } else if (event.key === 'Escape') {
      this._closeAndReset();
    } else if (event.key === '1' && event.ctrlKey) {
      this.isForDayMode.set(!this.isForDayMode());
    }
  }

  private _focusSelectTaskMinimal(): void {
    // Try immediate focus, fallback to next tick if needed
    if (!this._tryFocus()) {
      setTimeout(() => this._tryFocus(), 0);
    }
  }

  private _tryFocus(): boolean {
    const selectTaskInput =
      this.selectTaskMinimal()?.nativeElement?.querySelector('input');
    if (selectTaskInput) {
      selectTaskInput.focus();
      return true;
    }
    return false;
  }

  private async addTask(): Promise<void> {
    if (this.isCreate() && this.newTaskTitle()) {
      // Create new task
      await this.createNewTask(this.newTaskTitle());
    } else if (!this.isCreate() && this.selectedTask()) {
      // Schedule existing task
      await this.scheduleExistingTask(this.selectedTask()!);
    }
  }

  private async createNewTask(title: string): Promise<void> {
    try {
      if (this.isForDayMode()) {
        // Plan task for day (no specific time)
        const id = this._taskService.add(title, false, {
          timeEstimate: 30 * 60 * 1000,
        });
        const task = await this._taskService.getByIdOnce$(id).toPromise();
        if (!task) {
          throw new Error(`Failed to retrieve task after creation. Task ID: ${id}`);
        }
        this._store.dispatch(
          PlannerActions.planTaskForDay({
            task: task,
            day: getDbDateStr(this.due()),
          }),
        );
      } else {
        // Schedule task with specific time
        this._taskService.addAndSchedule(
          title,
          {
            timeEstimate: 30 * 60 * 1000,
          },
          this.due(),
          this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
            DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
        );
      }
    } catch (error) {
      devError(`Failed to create or schedule task: ${error}`);
      this._snackService.open({
        type: 'ERROR',
        msg: 'Failed to create or schedule task',
      });
    }
  }

  private async scheduleExistingTask(task: Task): Promise<void> {
    if (this.isForDayMode()) {
      // Plan existing task for day
      this._store.dispatch(
        PlannerActions.planTaskForDay({
          task: task,
          day: getDbDateStr(this.due()),
        }),
      );
    } else {
      // Schedule existing task with specific time
      this._taskService.scheduleTask(
        task,
        this.due(),
        this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
          DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
      );
    }
  }

  private _formatTimeWithLeadingZero(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
}
