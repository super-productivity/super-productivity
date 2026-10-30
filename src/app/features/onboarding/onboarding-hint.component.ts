import { LiveAnnouncer } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  HostListener,
  inject,
  NgZone,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { OnboardingHintService } from './onboarding-hint.service';
import { QuickTourService } from './quick-tour.service';
import {
  HINT_ICON_PARAMS,
  HINT_ICON_PARAMS_EMPTY,
  HINT_STEP_CONFIGS,
  HintCandidate,
  HintStep,
  HintStepConfig,
} from './onboarding-hint-steps.const';
import { QuickTourCardComponent } from './quick-tour-card/quick-tour-card.component';
import { isTouchActive } from '../../util/input-intent';
import { GlobalConfigService } from '../config/global-config.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { T } from '../../t.const';

/** Max retries when target element is not yet in the DOM */
const MAX_POSITION_RETRIES = 10;
const POSITION_RETRY_DELAY_MS = 120;
const HINT_GAP_PX = 12;
/** Must match the glow spread in styles/components/onboarding-pulse.scss */
const PULSE_GLOW_PX = 8;
/** Must match max-width in onboarding-hint.component.scss */
const HINT_WIDTH_PX = 260;
const VIEWPORT_MARGIN_PX = 8;
/** Where the left arrow sits from the chip's top when the chip is beside its target */
const SIDE_ARROW_TOP_PX = 18;
/** Slightly longer than the slide transition (--transition-duration-l) */
const SLIDE_MS = 400;
// shortcut: polls while a polled step is up (only `organize`) — observe the
// nav's expanded state instead if more steps need it.
const POLL_TARGET_MS = 500;

const ANIMATION_DONE_EVENTS = [
  'animationend',
  'animationcancel',
  'transitionend',
  'transitioncancel',
] as const;

const isVisible = (el: HTMLElement): boolean => {
  const rect = el.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    (typeof el.checkVisibility !== 'function' ||
      el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
  );
};

const prefersReducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const stripTags = (html: string): string =>
  new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';

interface HintPosition {
  top: number;
  left: number;
  arrowOffset: number;
  arrowDirection: 'up' | 'down' | 'left';
}

interface ResolvedTarget {
  el: HTMLElement;
  message?: string;
}

@Component({
  selector: 'onboarding-hint',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, MatIcon, QuickTourCardComponent],
  templateUrl: './onboarding-hint.component.html',
  styleUrl: './onboarding-hint.component.scss',
})
export class OnboardingHintComponent {
  T = T;
  readonly ICON_PARAMS = HINT_ICON_PARAMS;
  onboardingHintService = inject(OnboardingHintService);
  quickTourService = inject(QuickTourService);
  hintPosition = signal<HintPosition | null>(null);
  hintMessage = signal<string>('');
  hintIcon = signal<string | null>(null);
  shortcutHint = signal<string | null>(null);
  isSliding = signal(false);
  /** Where the card grows from: the last chip, if the user just saw one. */
  cardFromRect = signal<DOMRect | null>(null);

  /** Part 1 wins: the tour starts only once part 1 is done. */
  readonly activeStep = computed(
    () => this.onboardingHintService.currentStep() ?? this.quickTourService.currentStep(),
  );
  readonly isWantMore = computed(() => this.activeStep() === 'want-more');
  readonly isTourStep = computed(
    () =>
      this.onboardingHintService.currentStep() === null &&
      this.quickTourService.currentStep() !== null,
  );
  readonly actions = computed(() => {
    const step = this.activeStep();
    return step && step !== 'want-more'
      ? (HINT_STEP_CONFIGS.get(step)?.actions ?? null)
      : null;
  });
  readonly timerNote = computed(() => {
    if (!this.quickTourService.isTimerNoteShown()) {
      return null;
    }
    const key = this._globalConfigService.cfg()?.keyboard?.togglePlay;
    return isTouchActive() || !key
      ? { message: T.ONBOARDING.TOUR.TIMER_RUNNING_TOUCH, params: HINT_ICON_PARAMS }
      : {
          message: T.ONBOARDING.TOUR.TIMER_RUNNING,
          params: { ...HINT_ICON_PARAMS, key },
        };
  });

  private _globalConfigService = inject(GlobalConfigService);
  private _layoutService = inject(LayoutService);
  private _liveAnnouncer = inject(LiveAnnouncer);
  private _translateService = inject(TranslateService);
  private _ngZone = inject(NgZone);
  private _activeStep: HintStep | null = null;
  // Step and message: a step's tip can change, e.g. once the side nav expands.
  private _announced: { step: HintStep; messageKey: string } | null = null;
  private _targetEl: HTMLElement | null = null;
  private _repositionFrame: number | null = null;
  private _pulsingEl: HTMLElement | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _positionTimeout: ReturnType<typeof setTimeout> | null = null;
  private _repositionTimeout: ReturnType<typeof setTimeout> | null = null;
  private _slideTimeout: ReturnType<typeof setTimeout> | null = null;
  private _pollInterval: ReturnType<typeof setInterval> | null = null;
  readonly hintChipEl = viewChild<ElementRef<HTMLDivElement>>('hintChipEl');

  constructor() {
    effect((onCleanup) => {
      const step = this.activeStep();
      if (step === 'want-more') {
        // Measured before the chip leaves the DOM, so the card grows from it.
        untracked(() => {
          this.cardFromRect.set(
            this.hintChipEl()?.nativeElement.getBoundingClientRect() ?? null,
          );
          this.hintPosition.set(null);
        });
        return;
      }
      if (step === null) {
        return;
      }
      this._activeStep = step;
      this._targetEl = null;
      untracked(() => this._startStep(step));

      onCleanup(() => {
        this._activeStep = null;
        this._targetEl = null;
        this._cleanupPulse();
        this._clearPositionTimeout();
        this._clearRepositionTimeout();
        this._stopPolling();
        this._resizeObserver?.disconnect();
      });
    });

    // The hint is position: fixed, so follow its target when anything scrolls
    // (capture phase: the task list scrolls inside its own container).
    const onViewportChange = (): void => this._scheduleReposition();
    this._ngZone.runOutsideAngular(() => {
      document.addEventListener('scroll', onViewportChange, {
        capture: true,
        passive: true,
      });
      window.addEventListener('resize', onViewportChange, { passive: true });
      // Transforms (e.g. the bottom nav sliding in on startup) move the target
      // without resizing it, so re-anchor once animations and transitions end.
      // Cancelled ones count too: AppComponent drops the nav's entrance class on
      // a timer, which cuts a slide that started late short (no animationend).
      for (const type of ANIMATION_DONE_EVENTS) {
        document.addEventListener(type, onViewportChange, { passive: true });
      }
    });
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('scroll', onViewportChange, { capture: true });
      window.removeEventListener('resize', onViewportChange);
      for (const type of ANIMATION_DONE_EVENTS) {
        document.removeEventListener(type, onViewportChange);
      }
      if (this._repositionFrame !== null) {
        cancelAnimationFrame(this._repositionFrame);
      }
      this._clearSlideTimeout();
    });
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    // An open menu or dialog handles Esc first.
    if (event.defaultPrevented) {
      return;
    }
    if (this.activeStep()) {
      this.close();
    }
  }

  /** ✕: part 1 ends quietly, the tour ends. */
  close(): void {
    if (this.onboardingHintService.currentStep()) {
      this.onboardingHintService.skip();
    } else {
      this.quickTourService.end();
    }
  }

  /** The chip stays and slides to the next target instead of popping up anew. */
  private _startStep(step: HintStep): void {
    const isSlide = this.hintPosition() !== null && !prefersReducedMotion();
    if (isSlide) {
      this._clearSlideTimeout();
      this.isSliding.set(true);
      this._slideTimeout = setTimeout(() => this.isSliding.set(false), SLIDE_MS);
    } else {
      this.hintPosition.set(null);
    }
    this._schedulePosition(step, 0);
    if (HINT_STEP_CONFIGS.get(step)?.isPolled) {
      this._ngZone.runOutsideAngular(() => {
        this._pollInterval = setInterval(
          () => this._scheduleReposition(),
          POLL_TARGET_MS,
        );
      });
    }
  }

  private _announce(step: HintStep, messageKey: string): void {
    if (this._announced?.step === step && this._announced.messageKey === messageKey) {
      return;
    }
    this._announced = { step, messageKey };
    const html = this._translateService.instant(messageKey, HINT_ICON_PARAMS_EMPTY);
    void this._liveAnnouncer.announce(stripTags(html));
  }

  private _messageKey(config: HintStepConfig): string {
    return config.message({
      isTouch: isTouchActive(),
      isPhone: this._layoutService.isShowMobileBottomNav(),
      isTimeTrackingEnabled:
        this._globalConfigService.appFeatures().isTimeTrackingEnabled,
    });
  }

  private _isMissingHandled(step: HintStep): boolean {
    if (!HINT_STEP_CONFIGS.get(step)?.isEndedWhenMissing) {
      return false;
    }
    const tourStep = this.quickTourService.currentStep();
    if (this.onboardingHintService.currentStep() === step) {
      this.onboardingHintService.skip();
    } else if (tourStep === step) {
      this.quickTourService.skipStep(tourStep);
    }
    return true;
  }

  /** Re-anchor on scroll/resize, or attach once the target appears. */
  private _scheduleReposition(): void {
    if (this._repositionFrame !== null || !this._activeStep) {
      return;
    }
    this._repositionFrame = requestAnimationFrame(() => {
      this._repositionFrame = null;
      const step = this._activeStep;
      if (!step) {
        return;
      }
      // Re-resolve: a better target may have appeared (e.g. the opened side nav).
      const config = HINT_STEP_CONFIGS.get(step);
      // Keep following the current target when nothing resolves, e.g. while the
      // layout swaps the header + for the bottom-nav one.
      const targetEl =
        (config ? this._resolveTarget(config)?.el : null) ??
        (this._targetEl?.isConnected ? this._targetEl : null);
      if (targetEl && targetEl === this._targetEl) {
        this._calculatePosition(targetEl, step);
      } else if (targetEl) {
        this._positionHintForStep(step);
      } else if (this._targetEl && config?.isEndedWhenMissing) {
        // The target is gone, e.g. the first task left the list: hide, and end
        // the tip unless the target comes back.
        this._targetEl = null;
        this.hintPosition.set(null);
        this._clearPositionTimeout();
        this._schedulePosition(step, 0);
      }
    });
  }

  private _resolveTarget(config: HintStepConfig): ResolvedTarget | null {
    const candidates = config.candidates({
      swipeTargetTaskId: this.onboardingHintService.swipeTargetTaskId(),
      firstTaskId: this.onboardingHintService.firstTaskId(),
      tourTaskId: this.quickTourService.tourTaskId(),
    });
    for (const candidate of candidates) {
      const { selector, message, visibleWith }: HintCandidate =
        typeof candidate === 'string' ? { selector: candidate } : candidate;
      // All matches: the side nav and the bottom nav may both render one.
      const el = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
        (match) => {
          const shownEl = visibleWith ? match.closest<HTMLElement>(visibleWith) : match;
          return !!shownEl && isVisible(shownEl);
        },
      );
      if (el) {
        return { el, message };
      }
    }
    return null;
  }

  private _measureHintHeight(): number | undefined {
    return this.hintChipEl()?.nativeElement.getBoundingClientRect().height || undefined;
  }

  private _schedulePosition(step: HintStep, retryCount: number): void {
    this._positionTimeout = setTimeout(
      () => {
        const found = this._positionHintForStep(step);
        if (found) {
          return;
        }
        if (retryCount < MAX_POSITION_RETRIES) {
          this._schedulePosition(step, retryCount + 1);
        } else {
          this._isMissingHandled(step);
        }
      },
      retryCount === 0 ? 0 : POSITION_RETRY_DELAY_MS,
    );
  }

  private _clearPositionTimeout(): void {
    if (this._positionTimeout !== null) {
      clearTimeout(this._positionTimeout);
      this._positionTimeout = null;
    }
  }

  private _clearRepositionTimeout(): void {
    if (this._repositionTimeout !== null) {
      clearTimeout(this._repositionTimeout);
      this._repositionTimeout = null;
    }
  }

  private _clearSlideTimeout(): void {
    if (this._slideTimeout !== null) {
      clearTimeout(this._slideTimeout);
      this._slideTimeout = null;
    }
  }

  private _stopPolling(): void {
    if (this._pollInterval !== null) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  private _positionHintForStep(step: HintStep): boolean {
    const config = HINT_STEP_CONFIGS.get(step);
    if (!config) {
      return false;
    }

    const target = this._resolveTarget(config);
    if (!target) {
      return false;
    }
    const { el: targetEl } = target;

    this._updateMessage(config, target.message);
    this._announce(step, this.hintMessage());
    this._targetEl = targetEl;
    if (config.isPulse) {
      this._applyPulse(targetEl);
    } else {
      this._cleanupPulse();
    }
    this._calculatePosition(targetEl, step);

    // After the hint renders, re-measure with actual height for accurate positioning
    this._clearRepositionTimeout();
    this._repositionTimeout = setTimeout(() => {
      if (targetEl.isConnected) {
        this._calculatePosition(targetEl, step);
      }
    }, 0);

    this._resizeObserver?.disconnect();
    // Also reports the target leaving the DOM, e.g. the task row moving lists.
    this._resizeObserver = new ResizeObserver(() => this._scheduleReposition());
    this._resizeObserver.observe(targetEl);
    return true;
  }

  private _updateMessage(config: HintStepConfig, candidateMessage?: string): void {
    this.hintMessage.set(candidateMessage ?? this._messageKey(config));
    this.hintIcon.set(config.icon ?? null);
    const shortcut =
      !isTouchActive() && config.shortcut
        ? this._globalConfigService.cfg()?.keyboard?.[config.shortcut]
        : null;
    this.shortcutHint.set(shortcut || null);
  }

  private _calculatePosition(targetEl: HTMLElement, step: HintStep): void {
    const config = HINT_STEP_CONFIGS.get(step);
    const rect = targetEl.getBoundingClientRect();
    // Prefer the rendered height: an estimate that is too small makes a hint
    // placed above its target (e.g. the mobile + button) cover it.
    const estimatedHintHeight = isTouchActive() ? 76 : 48;
    const hintHeight = this._measureHintHeight() ?? estimatedHintHeight;
    // Clear the target's pulse glow (8px box-shadow ring) and the hint's arrow.
    const gap = config?.isPulse ? HINT_GAP_PX + PULSE_GLOW_PX : HINT_GAP_PX;

    // Beside the desktop side nav, so the chip does not cover the nav below.
    const isInSideNav =
      !!targetEl.closest('magic-side-nav') && !targetEl.closest('.nav-sidenav.mobile');
    if (
      isInSideNav &&
      rect.right + gap + HINT_WIDTH_PX + VIEWPORT_MARGIN_PX <= window.innerWidth
    ) {
      const targetMiddle = (rect.top + rect.bottom) / 2;
      const top = Math.min(
        Math.max(VIEWPORT_MARGIN_PX, targetMiddle - SIDE_ARROW_TOP_PX),
        window.innerHeight - hintHeight - VIEWPORT_MARGIN_PX,
      );
      this.hintPosition.set({
        top,
        left: rect.right + gap,
        arrowOffset: targetMiddle - top,
        arrowDirection: 'left',
      });
      return;
    }

    const spaceBelow = window.innerHeight - rect.bottom;
    const placeBelow = spaceBelow > hintHeight + gap;
    const top = Math.max(
      VIEWPORT_MARGIN_PX,
      placeBelow ? rect.bottom + gap : rect.top - hintHeight - gap,
    );

    // A task row spans the list: point at its title, not the middle of nowhere.
    const pointOffset = config?.isWide
      ? Math.min(rect.width / 2, this._layoutService.isShowMobileBottomNav() ? 60 : 120)
      : rect.width / 2;
    const targetX = rect.left + pointOffset;
    const halfHintWidth = HINT_WIDTH_PX / 2;
    const left = Math.min(
      Math.max(
        VIEWPORT_MARGIN_PX,
        config?.isWide ? targetX - SIDE_ARROW_TOP_PX : targetX - halfHintWidth,
      ),
      window.innerWidth - HINT_WIDTH_PX - VIEWPORT_MARGIN_PX,
    );

    const arrowOffset = Math.max(12, Math.min(targetX - left, HINT_WIDTH_PX - 12));
    const direction: 'up' | 'down' = placeBelow ? 'up' : 'down';

    this.hintPosition.set({ top, left, arrowOffset, arrowDirection: direction });
  }

  private _applyPulse(el: HTMLElement): void {
    this._cleanupPulse();
    el.classList.add('onboarding-pulse');
    this._pulsingEl = el;
  }

  private _cleanupPulse(): void {
    this._pulsingEl?.classList.remove('onboarding-pulse');
    this._pulsingEl = null;
  }
}
