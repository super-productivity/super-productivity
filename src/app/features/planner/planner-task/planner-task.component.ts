import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostBinding,
  HostListener,
  inject,
  Input,
  input,
  OnDestroy,
  OnInit,
  viewChild,
} from '@angular/core';
import { TaskCopy } from '../../tasks/task.model';
import { EMPTY, Observable } from 'rxjs';
import { TaskService } from '../../tasks/task.service';
import { IS_TOUCH_PRIMARY } from '../../../util/is-mouse-primary';
import { T } from '../../../t.const';
import { Project } from '../../project/project.model';
import { ProjectService } from '../../project/project.service';
import { takeUntil } from 'rxjs/operators';
import { BaseComponent } from '../../../core/base-component/base.component';
import { TaskContextMenuComponent } from '../../tasks/task-context-menu/task-context-menu.component';
import { MatIcon } from '@angular/material/icon';
import { LongPressIOSDirective } from '../../../ui/longpress/longpress-ios.directive';
import { TagListComponent } from '../../tag/tag-list/tag-list.component';
import { InlineInputComponent } from '../../../ui/inline-input/inline-input.component';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { IssueIconPipe } from '../../issue/issue-icon/issue-icon.pipe';
import { ShortDate2Pipe } from '../../../ui/pipes/short-date2.pipe';
import { Log } from '../../../core/log';

@Component({
  selector: 'planner-task',
  templateUrl: './planner-task.component.html',
  styleUrl: './planner-task.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatIcon,
    LongPressIOSDirective,
    TagListComponent,
    InlineInputComponent,
    TaskContextMenuComponent,
    MsToStringPipe,
    IssueIconPipe,
    ShortDate2Pipe,
  ],
})
export class PlannerTaskComponent extends BaseComponent implements OnInit, OnDestroy {
  private _taskService = inject(TaskService);
  private _cd = inject(ChangeDetectorRef);
  private _projectService = inject(ProjectService);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  @Input({ required: true }) task!: TaskCopy;

  // TODO remove
  readonly day = input<string | undefined>();
  readonly tagsToHide = input<string[]>();

  isRepeatTaskCreatedToday = false;

  readonly T = T;
  readonly IS_TOUCH_PRIMARY = IS_TOUCH_PRIMARY;
  parentTitle: string | null = null;

  moveToProjectList$!: Observable<Project[]>;

  readonly taskContextMenu = viewChild('taskContextMenu', {
    read: TaskContextMenuComponent,
  });

  @HostBinding('class.isDone')
  get isDone(): boolean {
    return this.task.isDone;
  }

  @HostBinding('class.isCurrent')
  get isCurrent(): boolean {
    return this.task.id === this._taskService.currentTaskId();
  }

  @HostListener('click')
  async clickHandler(): Promise<void> {
    if (this.task) {
      // Use bottom panel on mobile, dialog on desktop
      this._taskService.setSelectedId(this.task.id);
    }
  }

  // @HostListener('dblclick', ['$event'])
  // async dblClickHandler(): Promise<void> {
  //   if (this.task) {
  //     this._matDialog.open(DialogTaskAdditionalInfoPanelComponent, {
  //       data: { taskId: this.task.id },
  //     });
  //   }
  // }

  get timeEstimate(): number {
    const t = this.task;
    return this.task.subTaskIds
      ? t.timeEstimate
      : t.timeEstimate - t.timeSpent > 0
        ? t.timeEstimate - t.timeSpent
        : 0;
  }

  ngOnInit(): void {
    this.moveToProjectList$ = this.task.projectId
      ? this._projectService.getProjectsWithoutId$(this.task.projectId)
      : EMPTY;

    if (this.task.parentId) {
      this._taskService
        .getByIdLive$(this.task.parentId)
        .pipe(takeUntil(this.onDestroy$))
        .subscribe((parentTask) => {
          this.parentTitle = parentTask && parentTask.title;
          this._cd.markForCheck();
          this._cd.detectChanges();
        });
    }
  }

  // NOTE: this prevents dragging on mobile for no touch area
  onTouchStart(event: TouchEvent): void {
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  openContextMenu(event: TouchEvent | MouseEvent): void {
    this.taskContextMenu()?.open(event);
  }

  estimateTimeClick(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    // this._matDialog.open(DialogTimeEstimateComponent, {
    //   data: { task: this.task, isFocusEstimateOnMousePrimaryDevice: true },
    //   autoFocus: !IS_TOUCH_PRIMARY,
    // });
  }

  updateTimeEstimate(val: number): void {
    Log.log(val);
    this._taskService.update(this.task.id, {
      timeEstimate: val,
    });
  }
}
