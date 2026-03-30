import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  HostBinding,
  HostListener,
  inject,
  Input,
  input,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TaskCopy } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { isTouchActive } from '../../../util/input-intent';
import { IS_HYBRID_DEVICE } from '../../../util/is-mouse-primary';
import { DRAG_DELAY_FOR_TOUCH } from '../../../app.constants';
import { T } from '../../../t.const';
import { TaskContextMenuComponent } from '../../tasks/task-context-menu/task-context-menu.component';
import { MatIcon } from '@angular/material/icon';
import { TagListComponent } from '../../tag/tag-list/tag-list.component';
import { InlineInputComponent } from '../../../ui/inline-input/inline-input.component';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { hasLinkHints, RenderLinksPipe } from '../../../ui/pipes/render-links.pipe';
import { DoneToggleComponent } from '../../../ui/done-toggle/done-toggle.component';
import { SwipeBlockComponent } from '../../../ui/swipe-block/swipe-block.component';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'planner-task',
  templateUrl: './planner-task.component.html',
  styleUrl: './planner-task.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatIcon,
    TagListComponent,
    InlineInputComponent,
    TaskContextMenuComponent,
    MsToStringPipe,
    RenderLinksPipe,
    DoneToggleComponent,
    SwipeBlockComponent,
    TranslatePipe,
  ],
})
export class PlannerTaskComponent implements OnInit, OnDestroy, AfterViewInit {
  private _taskService = inject(TaskService);
  private _cd = inject(ChangeDetectorRef);
  private _destroyRef = inject(DestroyRef);
  private _elementRef = inject(ElementRef);
  get titleHasLinks(): boolean {
    const title = this.task?.title;
    return !!title && hasLinkHints(title);
  }

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  @Input({ required: true }) task!: TaskCopy;

  // TODO remove
  readonly day = input<string | undefined>();
  readonly tagsToHide = input<string[]>();

  readonly T = T;
  readonly isTouchActive = isTouchActive;
  parentTitle: string | null = null;
  isContextMenuLoaded = signal(false);
  showDoneAnimation = signal(false);
  showUndoneAnimation = signal(false);
  isDragReady = signal(false);
  private _doneAnimationTimeout?: number;
  private _dragReadyTimeout?: number;
  private _touchListenerCleanups: (() => void)[] = [];

  readonly taskContextMenu = viewChild('taskContextMenu', {
    read: TaskContextMenuComponent,
  });

  @HostBinding('class.isDone')
  get isDone(): boolean {
    return this.task.isDone;
  }

  @HostBinding('class.isDragReady')
  get isDragReadyClass(): boolean {
    return this.isDragReady();
  }

  @HostBinding('class.isCurrent')
  get isCurrent(): boolean {
    return this.task.id === this._taskService.currentTaskId();
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(event: MouseEvent): void {
    if (isTouchActive()) {
      event.preventDefault();
      return;
    }
    this.openContextMenu(event);
  }

  @HostListener('click', ['$event'])
  async clickHandler(event: MouseEvent): Promise<void> {
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'A' || target?.closest('a')) {
      return;
    }
    if (this.task) {
      // Use bottom panel on mobile, dialog on desktop
      this._taskService.setSelectedId(this.task.id);
    }
  }

  get timeEstimate(): number {
    const t = this.task;
    return this.task.subTaskIds
      ? t.timeEstimate
      : t.timeEstimate - t.timeSpent > 0
        ? t.timeEstimate - t.timeSpent
        : 0;
  }

  ngOnInit(): void {
    if (this.task.parentId) {
      this._taskService
        .getByIdLive$(this.task.parentId)
        .pipe(takeUntilDestroyed(this._destroyRef))
        .subscribe((parentTask) => {
          this.parentTitle = parentTask && parentTask.title;
          this._cd.markForCheck();
        });
    }
  }

  ngAfterViewInit(): void {
    if (isTouchActive() || IS_HYBRID_DEVICE) {
      const el = this._elementRef.nativeElement;
      const onStart = (): void => {
        this._dragReadyTimeout = window.setTimeout(() => {
          this.isDragReady.set(true);
        }, DRAG_DELAY_FOR_TOUCH);
      };
      const onEnd = (): void => {
        window.clearTimeout(this._dragReadyTimeout);
        this.isDragReady.set(false);
      };
      el.addEventListener('touchstart', onStart, { passive: true });
      el.addEventListener('touchend', onEnd, { passive: true });
      el.addEventListener('touchmove', onEnd, { passive: true });
      this._touchListenerCleanups = [
        () => el.removeEventListener('touchstart', onStart),
        () => el.removeEventListener('touchend', onEnd),
        () => el.removeEventListener('touchmove', onEnd),
      ];
    }
  }

  ngOnDestroy(): void {
    window.clearTimeout(this._doneAnimationTimeout);
    window.clearTimeout(this._dragReadyTimeout);
    this._touchListenerCleanups.forEach((fn) => fn());
  }

  onSwipeRightTriggered(isTriggered: boolean): void {
    if (this.task.isDone) {
      this.showUndoneAnimation.set(isTriggered);
    } else {
      this.showDoneAnimation.set(isTriggered);
    }
  }

  toggleTaskDone(): void {
    window.clearTimeout(this._doneAnimationTimeout);
    this._doneAnimationTimeout = this._taskService.toggleDoneWithAnimation(
      this.task.id,
      this.task.isDone,
      (v) => this.showDoneAnimation.set(v),
    );
  }

  openContextMenu(event?: TouchEvent | MouseEvent): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!this.isContextMenuLoaded()) {
      this.isContextMenuLoaded.set(true);
      setTimeout(() => {
        this.taskContextMenu()?.open(event);
      });
      return;
    }
    this.taskContextMenu()?.open(event);
  }

  estimateTimeClick(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
  }

  updateTimeEstimate(val: number): void {
    this._taskService.update(this.task.id, {
      timeEstimate: val,
    });
  }
}
