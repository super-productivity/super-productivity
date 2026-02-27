import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnDestroy,
  OnInit,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
} from '@angular/material/dialog';
import { TaskService } from '../../tasks/task.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, Subscription } from 'rxjs';
import { Task } from '../../tasks/task.model';
import { GlobalConfigService } from '../../config/global-config.service';
import { T } from '../../../t.const';
import { IS_ELECTRON } from '../../../app.constants';
import { SimpleCounter } from '../../simple-counter/simple-counter.model';
import { Store } from '@ngrx/store';
import { selectIdleTime } from '../store/idle.selectors';
import {
  DialogIdlePassedData,
  DialogIdleReturnData,
  DialogIdleSplitPassedData,
  DialogIdleSplitReturnData,
  SimpleCounterIdleBtn,
} from './dialog-idle.model';
import { DialogIdleSplitComponent } from './dialog-idle-split-mode/dialog-idle-split.component';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton, MatMiniFabButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatCheckbox } from '@angular/material/checkbox';
import { AsyncPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { SelectTaskComponent } from '../../tasks/select-task/select-task.component';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { expandAnimation } from '../../../ui/animations/expand.ani';

@Component({
  selector: 'dialog-idle',
  templateUrl: './dialog-idle.component.html',
  styleUrls: ['./dialog-idle.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogContent,
    MatIconButton,
    MatTooltip,
    MatIcon,
    MatMiniFabButton,
    MatCheckbox,
    MatDialogActions,
    MatButton,
    AsyncPipe,
    TranslatePipe,
    SelectTaskComponent,
    MsToStringPipe,
  ],
  animations: [expandAnimation],
})
export class DialogIdleComponent implements OnInit, OnDestroy {
  configService = inject(GlobalConfigService);
  private _taskService = inject(TaskService);
  private _matDialogRef =
    inject<MatDialogRef<DialogIdleComponent, DialogIdleReturnData>>(MatDialogRef);
  private _matDialog = inject(MatDialog);
  private _store = inject(Store);
  private _destroyRef = inject(DestroyRef);
  data = inject<DialogIdlePassedData>(MAT_DIALOG_DATA);

  T: typeof T = T;

  lastCurrentTask$: Observable<Task> = this.data.lastCurrentTaskId
    ? this._taskService.getByIdOnce$(this.data.lastCurrentTaskId)
    : EMPTY;

  idleTime$ = this._store.select(selectIdleTime);
  selectedTask: Task | null = null;
  newTaskTitle?: string;
  isCreate?: boolean;

  simpleCounterToggleBtns: SimpleCounterIdleBtn[] = [];
  isTaskDataLoadedIfNeeded: boolean = !this.data.lastCurrentTaskId;
  isResetBreakTimer: boolean = false;

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

  showSplit(): void {
    this._matDialog
      .open<
        DialogIdleSplitComponent,
        DialogIdleSplitPassedData,
        DialogIdleSplitReturnData | undefined
      >(DialogIdleSplitComponent, {
        data: {
          simpleCounterToggleBtns: this.simpleCounterToggleBtns,
          prevSelectedTask: this.selectedTask,
          newTaskTitle: this.newTaskTitle,
        },
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((res) => {
        if (res) {
          this._matDialogRef.close({
            isResetBreakTimer: this.isResetBreakTimer,
            trackItems: res.trackItems,
            wasFocusSessionRunning: this.data.wasFocusSessionRunning,
          });
        }
      });
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

  skipTrack(): void {
    this._matDialogRef.close({
      isResetBreakTimer: this.isResetBreakTimer,
      trackItems: [],
      simpleCounterToggleBtnsWhenNoTrackItems: this.simpleCounterToggleBtns,
      wasFocusSessionRunning: this.data.wasFocusSessionRunning,
    });
  }

  trackAsBreak(): void {
    this._matDialogRef.close({
      isResetBreakTimer: this.isResetBreakTimer,
      wasFocusSessionRunning: this.data.wasFocusSessionRunning,
      trackItems: [
        {
          type: 'BREAK',
          time: 'IDLE_TIME',
          simpleCounterToggleBtns: this.simpleCounterToggleBtns,
        },
      ],
    });
  }

  track(): void {
    this._matDialogRef.close({
      isResetBreakTimer: this.isResetBreakTimer,
      wasFocusSessionRunning: this.data.wasFocusSessionRunning,
      trackItems: [
        {
          type: 'TASK',
          time: 'IDLE_TIME',
          simpleCounterToggleBtns: this.simpleCounterToggleBtns,
          ...(this.isCreate
            ? { title: this.newTaskTitle as string }
            : { task: this.selectedTask as Task }),
        },
      ],
    });
  }

  hasActiveSimpleCounterTimerButton(): boolean {
    return this.simpleCounterToggleBtns.some((btn) => btn.isTrackTo);
  }
}
