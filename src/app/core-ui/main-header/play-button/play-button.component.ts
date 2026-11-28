import {
  afterNextRender,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  OnDestroy,
  OnInit,
  Renderer2,
  viewChild,
} from '@angular/core';
import { MatMiniFabButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LongPressDirective } from '../../../ui/longpress/longpress.directive';
import { MagicNavConfigService } from '../../magic-side-nav/magic-nav-config.service';
import { T } from '../../../t.const';
import { TaskService } from '../../../features/tasks/task.service';
import { TrackingPresenceService } from '../../../features/tracking-presence/tracking-presence.service';
import { animationFrameScheduler, Subscription } from 'rxjs';
import { auditTime, distinctUntilChanged } from 'rxjs/operators';

@Component({
  selector: 'play-button',
  standalone: true,
  imports: [
    MatMiniFabButton,
    MatIcon,
    MatTooltip,
    TranslatePipe,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    LongPressDirective,
  ],
  template: `
    <div
      class="play-btn-wrapper"
      [class.isRemote]="remoteDeviceLabel()"
    >
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
        #playBtn
        (pointerdown)="onPlayPointerDown()"
        (click)="onPlayClick()"
        (contextmenu)="$event.preventDefault(); openFeatureMenu()"
        (longPress)="onLongPress()"
        [color]="currentTaskId() ? 'accent' : 'primary'"
        [matTooltip]="tooltipText() | translate: { device: remoteDeviceLabel() }"
        [attr.aria-label]="tooltipText() | translate: { device: remoteDeviceLabel() }"
        matTooltipPosition="below"
        class="play-btn tour-playBtn mat-elevation-z3"
        [class.mat-mini-fab-icon]="isIconButton()"
        mat-mini-fab
        [disabled]="isDisabled()"
      >
        @if (!currentTaskId()) {
          <mat-icon>play_arrow</mat-icon>
        } @else {
          <mat-icon>pause</mat-icon>
        }
      </button>
      @if (remoteDeviceLabel()) {
        <span class="remote-badge"><mat-icon>devices</mat-icon></span>
      }

      <!-- Anchor only: opened from right-click / long-press (or the context-menu
           key) on the button, so focus returns to the button, not the anchor. -->
      <span
        class="feature-menu-anchor"
        [matMenuTriggerFor]="featureMenu"
        [matMenuTriggerRestoreFocus]="false"
        (menuClosed)="onFeatureMenuClosed()"
      ></span>
      <mat-menu #featureMenu="matMenu">
        <button
          mat-menu-item
          (click)="disableTimeTracking()"
        >
          <mat-icon>visibility_off</mat-icon>
          <span>{{ T.MH.DISABLE_FEATURE | translate }}</span>
        </button>
      </mat-menu>
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

        .feature-menu-anchor {
          position: absolute;
          left: 50%;
          bottom: 0;
          width: 0;
          height: 0;
          pointer-events: none;
        }

        /* Another device tracks: dashed accent ring + device badge. Outside a
           filled FAB (an edge ring vanishes into its fill), on the edge of the
           transparent mobile icon button. */
        &.isRemote .play-btn {
          outline: 2px dashed var(--c-accent);
          outline-offset: 3px;

          &.mat-mini-fab-icon {
            --mat-fab-small-foreground-color: var(--c-accent);
            outline-width: 1.5px;
            outline-offset: -2px;
          }
        }

        .remote-badge {
          position: absolute;
          right: -5px;
          bottom: -5px;
          z-index: 7;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--c-accent);
          color: var(--palette-accent-contrast-500);
          box-shadow: 0 0 0 2px var(--bg);
          pointer-events: none;

          .mat-icon {
            font-size: 11px;
            width: 11px;
            height: 11px;
            line-height: 11px;
          }
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
  private _navConfigService = inject(MagicNavConfigService);
  private _injector = inject(Injector);
  private _translateService = inject(TranslateService);
  private _isLongPressClick = false;

  readonly T = T;
  readonly taskService = inject(TaskService);
  private _presenceService = inject(TrackingPresenceService);

  readonly currentTaskId = input<string | null>();
  readonly isMobile = input(false);
  readonly isIconButton = computed(() => this.isMobile() && !this.currentTaskId());
  readonly hasTrackableTasks = input<boolean>(true);
  readonly circleSvg = viewChild<ElementRef<SVGCircleElement>>('circleSvg');
  readonly featureMenuTrigger = viewChild(MatMenuTrigger);
  // `read`: on a Material button the template ref is the component, not the element.
  readonly playBtn = viewChild('playBtn', { read: ElementRef<HTMLButtonElement> });

  readonly isDisabled = computed(
    () => !this.currentTaskId() && !this.hasTrackableTasks(),
  );
  /**
   * Device actively tracking elsewhere, else null. Same live-and-tracking rule
   * as the pill's Stop, so a stale or paused session never rings the button;
   * hidden while disabled, as the ring offers a takeover that can't happen.
   * A string, so the staleness tick's fresh view object doesn't re-render.
   */
  readonly remoteDeviceLabel = computed(() => {
    const view = this._presenceService.remoteSessionView();
    return view?.showStop && !this.isDisabled() ? view.session.payload.deviceLabel : null;
  });
  readonly tooltipText = computed(() =>
    this.isDisabled()
      ? T.MH.NO_TASKS_TO_TRACK
      : this.remoteDeviceLabel()
        ? T.F.TRACKING_PRESENCE.PLAY_BTN.TOOLTIP
        : T.MH.TOGGLE_TRACK_TIME,
  );

  private _subs = new Subscription();
  private circumference = 10 * 2 * Math.PI; // ~62.83
  protected hasTimeEstimate = false;

  /** A new press starts fresh, whether or not the last long press ended in a click. */
  onPlayPointerDown(): void {
    this._isLongPressClick = false;
  }

  onPlayClick(): void {
    // The click that ends a long press must not also start or stop tracking.
    if (this._isLongPressClick) {
      this._isLongPressClick = false;
      return;
    }
    this.taskService.toggleStartTask();
  }

  onLongPress(): void {
    this._isLongPressClick = true;
    this.openFeatureMenu();
  }

  /** Same "Disable feature" as the side nav items offer for their features. */
  openFeatureMenu(): void {
    this.featureMenuTrigger()?.openMenu();
  }

  onFeatureMenuClosed(): void {
    const btn = this.playBtn()?.nativeElement;
    btn?.focus();
    // mat-menu queues "focus first item" for the render after opening and doesn't
    // cancel it on close, so an Escape before that render (zoneless) lets it pull
    // focus into the detaching panel, dropping it to <body>. The `read` phase runs
    // after that hook; only reclaim focus it took, so Tab-out still moves on.
    afterNextRender(
      {
        read: () => {
          const active = document.activeElement;
          if (active === document.body || active?.closest('.mat-mdc-menu-panel')) {
            btn?.focus();
          }
        },
      },
      { injector: this._injector },
    );
  }

  disableTimeTracking(): void {
    this._navConfigService.disableFeature(
      'isTimeTrackingEnabled',
      this._translateService.instant(T.GCF.APP_FEATURES.TIME_TRACKING),
    );
  }

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
          // auditTime keeps only the latest value per frame: a hidden window
          // runs no frames, and observeOn would queue one update per tick.
          auditTime(0, animationFrameScheduler),
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
