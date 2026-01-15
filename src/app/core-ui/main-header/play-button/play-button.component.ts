import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnDestroy,
  OnInit,
  Renderer2,
  viewChild,
} from '@angular/core';
import { MatMiniFabButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { TagComponent } from '../../../features/tag/tag/tag.component';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { expandFadeHorizontalAnimation } from '../../../ui/animations/expand.ani';
import { T } from '../../../t.const';
import { Task } from '../../../features/tasks/task.model';
import { WorkContext } from '../../../features/work-context/work-context.model';
import { TaskService } from '../../../features/tasks/task.service';
import { animationFrameScheduler, Subscription } from 'rxjs';
import { distinctUntilChanged, observeOn } from 'rxjs/operators';

@Component({
  selector: 'play-button',
  standalone: true,
  imports: [MatMiniFabButton, MatIcon, MatTooltip, TranslatePipe, TagComponent],
  template: `
    <div class="play-btn-wrapper">
      @if (currentTask(); as task) {
        <div
          @fade
          class="current-task-title"
        >
          <div class="title">{{ task.title }}</div>
          @if (currentTaskContext(); as taskContext) {
            <tag
              @expandFadeHorizontal
              [tag]="taskContext"
              class="project"
            ></tag>
          }
        </div>
      }
      @if (currentTaskId()) {
        <div class="pulse-circle"></div>
      }

      @if (hasTimeEstimate) {
        <svg
          class="circle-svg"
          focusable="false"
          height="40"
          width="40"
        >
          <circle
            #circleSvg
            cx="50%"
            cy="50%"
            fill="none"
            r="10"
            stroke="currentColor"
            stroke-dasharray="62.83185307179586"
            stroke-dashoffset="0"
            stroke-width="20"
          ></circle>
        </svg>
      }

      <button
        (click)="taskService.toggleStartTask()"
        [color]="currentTaskId() ? 'accent' : 'primary'"
        [matTooltip]="tooltipText() | translate"
        matTooltipPosition="below"
        class="play-btn tour-playBtn mat-elevation-z3"
        mat-mini-fab
        [disabled]="isDisabled()"
      >
        @if (!currentTaskId()) {
          <mat-icon>play_arrow</mat-icon>
        } @else {
          <mat-icon>pause</mat-icon>
        }
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      @keyframes pulse {
        0% {
          transform: scale(0.7);
        }
        25% {
          transform: scale(1);
        }
        50% {
          transform: scale(1);
        }
        100% {
          transform: scale(0.7);
        }
      }

      .play-btn-wrapper {
        position: relative;
        margin: 0 6px;

        .pulse-circle {
          width: 48px;
          height: 48px;
          position: absolute;
          top: 0;
          left: -4px;
          right: 0;
          bottom: 0;
          border-radius: 50%;
          margin: auto;
          transform: scale(1, 1);
          animation: pulse 2s infinite;
          background: var(--c-accent);
          opacity: 0.6;
        }

        .circle-svg {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          margin: auto;
          transform: rotate(-90deg);
          opacity: 0.15;
          pointer-events: none;
          z-index: 3;
        }

        .play-btn {
          position: relative;
          margin-left: 0;
          z-index: 2;
          box-shadow: var(--whiteframe-shadow-2dp);

          .mat-icon {
            position: relative;
            z-index: 2;
          }
        }
      }

      .current-task-title {
        position: absolute;
        right: 100%;
        width: auto;
        border: 2px solid var(--c-accent);
        border-radius: 12px;
        min-width: 50px;
        white-space: nowrap;
        padding: var(--s-half) var(--s2);
        padding-right: calc(var(--s) * 2.5);
        margin-right: calc(-1 * var(--s) * 2);
        top: 50%;
        transform: translateY(-50%);
        transition: var(--transition-standard);
        display: flex;
        background: var(--bg-lighter);

        @media (max-width: 865px) {
          display: none;
        }

        .title {
          max-width: 250px;
          text-overflow: ellipsis;
          overflow: hidden;
        }

        .project {
          padding-right: 0;
        }
      }
    `,
  ],
  animations: [fadeAnimation, expandFadeHorizontalAnimation],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayButtonComponent implements OnInit, OnDestroy {
  private _renderer = inject(Renderer2);
  private _cd = inject(ChangeDetectorRef);

  readonly T = T;
  readonly taskService = inject(TaskService);

  readonly currentTask = input<Task | null>();
  readonly currentTaskId = input<string | null>();
  readonly currentTaskContext = input<WorkContext | null>();
  readonly hasTrackableTasks = input<boolean>(true);
  readonly circleSvg = viewChild<ElementRef<SVGCircleElement>>('circleSvg');

  readonly isDisabled = computed(
    () => !this.currentTaskId() && !this.hasTrackableTasks(),
  );
  readonly tooltipText = computed(() =>
    this.isDisabled() ? T.MH.NO_TASKS_TO_TRACK : T.MH.TOGGLE_TRACK_TIME,
  );

  private _subs = new Subscription();
  private circumference = 10 * 2 * Math.PI; // ~62.83
  protected hasTimeEstimate = false;

  ngOnInit(): void {
    // Subscribe to current task to track if it has a time estimate
    this._subs.add(
      this.taskService.currentTask$.subscribe((task) => {
        this.hasTimeEstimate = !!(task && task.timeEstimate && task.timeEstimate > 0);
        this._cd.markForCheck();
      }),
    );

    // Subscribe to task progress for circle animation
    this._subs.add(
      this.taskService.currentTaskProgress$
        .pipe(
          // Align ring updates with the frame budget and skip duplicate ratios.
          observeOn(animationFrameScheduler),
          distinctUntilChanged(),
        )
        .subscribe((progressIN) => {
          const circleSvgEl = this.circleSvg()?.nativeElement;
          if (circleSvgEl) {
            let progress = progressIN || 0;
            if (progress > 1) {
              progress = 1;
            }
            // Calculate dashoffset: 0 when 0%, negative circumference when 100%
            // This shows the completed portion of the circle
            const dashOffset = this.circumference * -progress;
            this._renderer.setStyle(circleSvgEl, 'stroke-dashoffset', dashOffset);
          }
        }),
    );
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }
}
