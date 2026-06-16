import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  OnInit,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
} from '@angular/material/dialog';
import { TaskService } from '../../tasks/task.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, Subscription } from 'rxjs';
import { Task } from '../../tasks/task.model';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { T } from '../../../t.const';
import { IS_ELECTRON } from '../../../app.constants';
import { SimpleCounter } from '../../simple-counter/simple-counter.model';
import { Store } from '@ngrx/store';
import { selectIdleTime } from '../store/idle.selectors';
import { LS } from '../../../core/persistence/storage-keys.const';
import {
  DialogIdlePassedData,
  DialogIdleReturnData,
  IdleTrackItem,
  SimpleCounterIdleBtn,
} from './dialog-idle.model';
import { dirtyDeepCopy } from '../../../util/dirtyDeepCopy';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { MatButton, MatIconButton, MatMiniFabButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { AsyncPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { SelectTaskComponent } from '../../tasks/select-task/select-task.component';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { InputDurationDirective } from '../../../ui/duration/input-duration.directive';
import { expandAnimation } from '../../../ui/animations/expand.ani';

export type IdleDialogMode = 'BREAK' | 'TASK' | 'SPLIT';

@Component({
  selector: 'dialog-idle',
  templateUrl: './dialog-idle.component.html',
  styleUrls: ['./dialog-idle.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIconButton,
    MatMiniFabButton,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatTooltip,
    MatIcon,
    MatCheckbox,
    MatFormField,
    MatLabel,
    MatSuffix,
    MatInput,
    AsyncPipe,
    NgTemplateOutlet,
    TranslatePipe,
    SelectTaskComponent,
    MsToStringPipe,
    InputDurationDirective,
  ],
  animations: [expandAnimation],
})
export class DialogIdleComponent implements OnInit, OnDestroy {
  configService = inject(GlobalConfigService);
  private _taskService = inject(TaskService);
  private _matDialogRef =
    inject<MatDialogRef<DialogIdleComponent, DialogIdleReturnData>>(MatDialogRef);
  private _store = inject(Store);
  data = inject<DialogIdlePassedData>(MAT_DIALOG_DATA);

  T: typeof T = T;

  lastCurrentTask$: Observable<Task> = this.data.lastCurrentTaskId
    ? this._taskService.getByIdOnce$(this.data.lastCurrentTaskId)
    : EMPTY;

  idleTime = toSignal(this._store.select(selectIdleTime), { initialValue: 0 });

  isNarrowScreen = inject(LayoutService).isXs;

  mode: IdleDialogMode | null = null;
  selectedTask: Task | null = null;
  newTaskTitle?: string;
  isCreate?: boolean;

  splitItems: IdleTrackItem[] = [];

  simpleCounterToggleBtns: SimpleCounterIdleBtn[] = [];
  isTaskDataLoadedIfNeeded: boolean = !this.data.lastCurrentTaskId;
  isResetBreakTimer: boolean = false;
  private _isResetBreakTimerSetByUser: boolean = false;

  private _subs = new Subscription();

  constructor() {
    const _matDialogRef = this._matDialogRef;
    const data = this.data;

    this.simpleCounterToggleBtns = (
      data.enabledSimpleStopWatchCounters as SimpleCounter[]
    ).map(
      ({ id, icon, title, isOn }: SimpleCounter): SimpleCounterIdleBtn =>
        ({
          id,
          icon: icon,
          title,
          isTrackTo: isOn,
          isWasEnabledBefore: isOn,
        }) as SimpleCounterIdleBtn,
    );
    _matDialogRef.disableClose = true;
  }

  ngOnInit(): void {
    if (this.data.lastCurrentTaskId) {
      // a live current task is a stronger signal than the remembered choice
      this.mode = 'TASK';
    } else {
      const lastMode = localStorage.getItem(LS.LAST_IDLE_DIALOG_MODE);
      if (lastMode === 'BREAK' || lastMode === 'TASK' || lastMode === 'SPLIT') {
        this.selectMode(lastMode);
      }
    }

    this._subs.add(
      this.lastCurrentTask$.subscribe((task) => {
        this.selectedTask = task;
        this.isCreate = false;
        this.isTaskDataLoadedIfNeeded = true;
      }),
    );

    if (IS_ELECTRON) {
      window.ea.flashFrame();
    }
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  selectMode(mode: IdleDialogMode): void {
    this.mode = mode;
    localStorage.setItem(LS.LAST_IDLE_DIALOG_MODE, mode);
    // re-seed as long as no time has been entered yet, so a task selected or
    // counter toggled after an earlier SPLIT visit is reflected on re-entry
    if (mode === 'SPLIT' && this.splitItems.every((item) => !item.time)) {
      this._initSplitItems();
    }
    this._updateResetBreakTimerDefault();
  }

  onTaskChange(taskOrTaskTitle: Task | string): void {
    this.isCreate = typeof taskOrTaskTitle === 'string';
    if (this.isCreate) {
      this.newTaskTitle = taskOrTaskTitle as string;
      this.selectedTask = null;
    } else {
      this.selectedTask = taskOrTaskTitle as Task;
      this.newTaskTitle = undefined;
    }
  }

  onSplitTaskChange(item: IdleTrackItem, taskOrTaskTitle: Task | string): void {
    if (typeof taskOrTaskTitle === 'string') {
      item.title = taskOrTaskTitle;
      item.task = undefined;
    } else {
      item.task = taskOrTaskTitle;
      item.title = undefined;
    }
  }

  onSplitTypeChange(): void {
    this._updateResetBreakTimerDefault();
  }

  onResetBreakTimerChange(isChecked: boolean): void {
    this.isResetBreakTimer = isChecked;
    this._isResetBreakTimerSetByUser = true;
  }

  addSplitItem(): void {
    this.splitItems.push({
      type: 'TASK',
      time: 0,
      title: '',
      simpleCounterToggleBtns: dirtyDeepCopy(this.simpleCounterToggleBtns),
    });
  }

  removeSplitItem(itemToRemove: IdleTrackItem): void {
    this.splitItems = this.splitItems.filter((item) => item !== itemToRemove);
    this._updateResetBreakTimerDefault();
  }

  get splitTimeAssigned(): number {
    return this.splitItems.reduce(
      (acc, item) => acc + (typeof item.time === 'number' ? item.time : 0),
      0,
    );
  }

  get splitTimeRemaining(): number {
    return this.idleTime() - this.splitTimeAssigned;
  }

  get splitTimeOver(): number {
    return Math.max(0, -this.splitTimeRemaining);
  }

  // NOTE: the idle time keeps counting up while the dialog is open, so the remainder
  // is only meaningful at minute granularity
  get isSplitUnderAssigned(): boolean {
    return this.splitTimeRemaining >= 60000;
  }

  get isSplitOverAssigned(): boolean {
    return this.splitTimeOver >= 60000;
  }

  assignRemainingTime(item: IdleTrackItem): void {
    const remaining = this.splitTimeRemaining;
    if (remaining > 0) {
      item.time = (typeof item.time === 'number' ? item.time : 0) + remaining;
    }
  }

  get isConfirmEnabled(): boolean {
    switch (this.mode) {
      case 'BREAK':
        return true;
      case 'TASK':
        return !!(this.selectedTask || this.newTaskTitle?.trim());
      case 'SPLIT':
        return (
          this.splitItems.length > 0 &&
          this.splitItems.every(
            (item) =>
              typeof item.time === 'number' &&
              item.time > 0 &&
              (item.type === 'BREAK' || !!item.task || !!item.title?.trim()),
          )
        );
      default:
        return false;
    }
  }

  get confirmLabelKey(): string {
    switch (this.mode) {
      case 'BREAK':
        return T.F.TIME_TRACKING.D_IDLE.CONFIRM_BREAK;
      case 'TASK':
        return this._isCreateNewTask
          ? T.F.TIME_TRACKING.D_IDLE.CONFIRM_CREATE_TASK
          : T.F.TIME_TRACKING.D_IDLE.CONFIRM_TASK;
      case 'SPLIT':
        return T.F.TIME_TRACKING.D_IDLE.CONFIRM_SPLIT;
      default:
        return T.F.TIME_TRACKING.D_IDLE.CONFIRM_TRACK;
    }
  }

  get confirmIcon(): string {
    switch (this.mode) {
      case 'BREAK':
        return 'free_breakfast';
      case 'TASK':
        return this._isCreateNewTask ? 'add' : 'track_changes';
      case 'SPLIT':
        return 'done_all';
      default:
        return 'check';
    }
  }

  private get _isCreateNewTask(): boolean {
    return !!this.isCreate && !!this.newTaskTitle?.trim();
  }

  confirm(): void {
    if (!this.isConfirmEnabled) {
      return;
    }

    let trackItems: IdleTrackItem[];
    switch (this.mode) {
      case 'BREAK':
        trackItems = [
          {
            type: 'BREAK',
            time: 'IDLE_TIME',
            simpleCounterToggleBtns: this.simpleCounterToggleBtns,
          },
        ];
        break;

      case 'TASK':
        trackItems = [
          {
            type: 'TASK',
            time: 'IDLE_TIME',
            simpleCounterToggleBtns: this.simpleCounterToggleBtns,
            ...(this._isCreateNewTask
              ? { title: (this.newTaskTitle as string).trim() }
              : { task: this.selectedTask as Task }),
          },
        ];
        break;

      case 'SPLIT':
        trackItems = this.splitItems.map((item) =>
          typeof item.title === 'string' ? { ...item, title: item.title.trim() } : item,
        );
        break;

      default:
        return;
    }

    this._close(trackItems);
  }

  skipTrack(): void {
    this._close([], {
      simpleCounterToggleBtnsWhenNoTrackItems: this.simpleCounterToggleBtns,
      // the mode-based auto-default must not reset the break timer when
      // nothing gets tracked — only an explicit user choice counts here
      isResetBreakTimer: this._isResetBreakTimerSetByUser && this.isResetBreakTimer,
    });
  }

  private _close(
    trackItems: IdleTrackItem[],
    overrides: Partial<DialogIdleReturnData> = {},
  ): void {
    this._matDialogRef.close({
      isResetBreakTimer: this.isResetBreakTimer,
      wasFocusSessionRunning: this.data.wasFocusSessionRunning,
      trackItems,
      ...overrides,
    });
  }

  hasActiveSimpleCounterTimerButton(): boolean {
    return this.simpleCounterToggleBtns.some((btn) => btn.isTrackTo);
  }

  private _initSplitItems(): void {
    this.splitItems = [
      {
        type: 'BREAK',
        time: 0,
        simpleCounterToggleBtns: dirtyDeepCopy(this.simpleCounterToggleBtns),
      },
      {
        type: 'TASK',
        time: 0,
        ...(this.selectedTask
          ? { task: this.selectedTask }
          : { title: this.newTaskTitle ?? '' }),
        simpleCounterToggleBtns: dirtyDeepCopy(this.simpleCounterToggleBtns),
      },
    ];
  }

  private _updateResetBreakTimerDefault(): void {
    if (this._isResetBreakTimerSetByUser) {
      return;
    }
    this.isResetBreakTimer =
      this.mode === 'BREAK' ||
      (this.mode === 'SPLIT' && this.splitItems.some((item) => item.type === 'BREAK'));
  }
}
