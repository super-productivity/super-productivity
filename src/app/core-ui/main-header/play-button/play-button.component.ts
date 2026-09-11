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
import { T } from '../../../t.const';
import { TaskService } from '../../../features/tasks/task.service';
import { animationFrameScheduler, Subscription } from 'rxjs';
import { distinctUntilChanged, observeOn } from 'rxjs/operators';

@Component({
  selector: 'play-button',
  standalone: true,
  imports: [MatMiniFabButton, MatIcon, MatTooltip, TranslatePipe],
  template: `
    <div class="play-btn-wrapper">
      @if (currentTaskId()) {
        <div class="pulse-circle"></div>
      }

      @if (hasTimeEstimate) {
        <svg
          class="circle-svg"
          focusable="false"
          height="36"
          width="36"
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
        [attr.aria-label]="tooltipText() | translate"
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
          width: 42px;
          height: 42px;
          position: absolute;
          top: 0;
          left: -3px;
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
          z-index: 6;
          box-shadow: var(--whiteframe-shadow-2dp);

          .mat-icon {
            position: relative;
            z-index: 2;
            font-variation-settings:
              'FILL' 1,
              'wght' 400,
              'GRAD' 0,
              'opsz' 24;
          }
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayButtonComponent implements OnInit, OnDestroy {
  private _renderer = inject(Renderer2);
  private _cd = inject(ChangeDetectorRef);

  readonly T = T;
  readonly taskService = inject(TaskService);

  readonly currentTaskId = input<string | null>();
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
