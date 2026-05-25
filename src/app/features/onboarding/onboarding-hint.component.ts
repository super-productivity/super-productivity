import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { OnboardingHintService, OnboardingStep } from './onboarding-hint.service';
import { isTouchActive } from '../../util/input-intent';
import { GlobalConfigService } from '../config/global-config.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { T } from '../../t.const';

/** Max retries when target element is not yet in the DOM */
const MAX_POSITION_RETRIES = 10;
const POSITION_RETRY_DELAY_MS = 120;
const MOBILE_TASK_HINT_SELECTOR = '.today .task-list-wrapper .task-list-inner > task';
const MOBILE_CREATE_TASK_HINT_VERTICAL_OFFSET = 10;

interface StepConfig {
  selector: ((isMobile: boolean) => string | null) | null;
  message: string;
  touchMessage?: string;
  touchActions?: TouchHintAction[];
  showShortcut: boolean;
}

interface TouchHintAction {
  icon: string;
  text: string;
}

const STEP_CONFIGS = new Map<OnboardingStep, StepConfig>([
  [
    'create-task',
    {
      selector: (isMobile) => (isMobile ? '.add-task-button' : '.tour-addBtn'),
      message: T.ONBOARDING.HINTS.CREATE_TASK,
      touchMessage: T.ONBOARDING.HINTS.CREATE_TASK_TOUCH,
      showShortcut: true,
    },
  ],
  [
    'task-tap',
    {
      selector: () => MOBILE_TASK_HINT_SELECTOR,
      message: T.ONBOARDING.HINTS.EXPLORE,
      touchMessage: T.ONBOARDING.HINTS.TASK_TAP_TOUCH,
      showShortcut: false,
    },
  ],
  [
    'task-swipe-left',
    {
      selector: () => MOBILE_TASK_HINT_SELECTOR,
      message: T.ONBOARDING.HINTS.EXPLORE,
      touchActions: [
        {
          icon: 'swipe_left',
          text: T.ONBOARDING.HINTS.TASK_SWIPE_LEFT_TOUCH,
        },
      ],
      showShortcut: false,
    },
  ],
  [
    'task-swipe-right',
    {
      selector: () => MOBILE_TASK_HINT_SELECTOR,
      message: T.ONBOARDING.HINTS.EXPLORE,
      touchActions: [
        {
          icon: 'swipe_right',
          text: T.ONBOARDING.HINTS.TASK_SWIPE_RIGHT_TOUCH,
        },
      ],
      showShortcut: false,
    },
  ],
  [
    'explore',
    {
      selector: (isMobile) => (isMobile ? MOBILE_TASK_HINT_SELECTOR : null),
      message: T.ONBOARDING.HINTS.EXPLORE,
      touchMessage: T.ONBOARDING.HINTS.EXPLORE_TOUCH,
      showShortcut: false,
    },
  ],
]);

interface HintPosition {
  top: number;
  left: number;
  arrowOffset: number;
  arrowDirection: 'up' | 'down';
}

@Component({
  selector: 'onboarding-hint',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, MatIcon],
  templateUrl: './onboarding-hint.component.html',
  styleUrl: './onboarding-hint.component.scss',
})
export class OnboardingHintComponent {
  T = T;
  onboardingHintService = inject(OnboardingHintService);
  hintPosition = signal<HintPosition | null>(null);
  hintMessage = signal<string>('');
  hintActions = signal<TouchHintAction[]>([]);
  shortcutHint = signal<string | null>(null);
  isFloating = signal(false);

  private _globalConfigService = inject(GlobalConfigService);
  private _layoutService = inject(LayoutService);
  private _pulsingEl: HTMLElement | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _positionTimeout: ReturnType<typeof setTimeout> | null = null;
  private _repositionTimeout: ReturnType<typeof setTimeout> | null = null;
  readonly hintChipEl = viewChild<ElementRef<HTMLDivElement>>('hintChipEl');

  constructor() {
    effect((onCleanup) => {
      const step = this.onboardingHintService.currentStep();
      if (step === null) {
        return;
      }
      this._schedulePosition(step, 0);

      onCleanup(() => {
        this._cleanupPulse();
        this._clearPositionTimeout();
        this._clearRepositionTimeout();
        this._resizeObserver?.disconnect();
      });
    });
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (event.defaultPrevented) {
      return;
    }
    if (this.onboardingHintService.currentStep()) {
      this.skip();
    }
  }

  skip(): void {
    this.onboardingHintService.skip();
  }

  private _schedulePosition(step: OnboardingStep, retryCount: number): void {
    this._positionTimeout = setTimeout(
      () => {
        const found = this._positionHintForStep(step);
        if (!found && retryCount < MAX_POSITION_RETRIES) {
          this._schedulePosition(step, retryCount + 1);
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

  private _positionHintForStep(step: OnboardingStep): boolean {
    const config = STEP_CONFIGS.get(step);
    if (!config) {
      return false;
    }

    this._updateMessage(config);

    const isMobile = isTouchActive() && this._layoutService.isShowMobileBottomNav();
    const selector = config.selector?.(isMobile) ?? null;

    // Floating hint (no target element)
    if (selector === null) {
      this.isFloating.set(true);
      this._cleanupPulse();
      this.hintPosition.set({ top: 0, left: 0, arrowOffset: 0, arrowDirection: 'up' });
      return true;
    }

    this.isFloating.set(false);
    const targetEl = document.querySelector<HTMLElement>(selector);
    if (!targetEl) {
      return false;
    }

    this._applyPulse(targetEl);
    this._calculatePosition(targetEl, step);

    // After the hint renders, re-measure with actual height for accurate positioning
    this._clearRepositionTimeout();
    this._repositionTimeout = setTimeout(() => {
      const measured = this.hintChipEl()?.nativeElement.getBoundingClientRect().height;
      if (measured && targetEl.isConnected) {
        this._calculatePosition(targetEl, step, measured);
      }
    }, 0);

    this._resizeObserver?.disconnect();
    this._resizeObserver = new ResizeObserver(() => {
      if (targetEl.isConnected) {
        this._calculatePosition(targetEl, step);
      }
    });
    this._resizeObserver.observe(targetEl);
    return true;
  }

  private _updateMessage(config: StepConfig): void {
    this.hintMessage.set(isTouchActive() ? (config.touchMessage ?? '') : config.message);
    this.hintActions.set(isTouchActive() ? (config.touchActions ?? []) : []);
    if (!isTouchActive() && config.showShortcut) {
      const shortcut = this._globalConfigService.cfg()?.keyboard?.addNewTask;
      this.shortcutHint.set(shortcut || null);
    } else {
      this.shortcutHint.set(null);
    }
  }

  private _calculatePosition(
    targetEl: HTMLElement,
    step: OnboardingStep,
    measuredHintHeight?: number,
  ): void {
    const rect = targetEl.getBoundingClientRect();
    // Must match max-width in onboarding-hint.component.scss
    const hintWidth = 260;
    // Approximate rendered height of the hint chip.
    // Touch hints can wrap to multiple lines, especially for task gesture onboarding.
    const estimatedHintHeight = isTouchActive()
      ? this.hintActions().length > 0
        ? 136
        : 76
      : 48;
    const hintHeight = measuredHintHeight ?? estimatedHintHeight;
    const gap = 12;

    const spaceBelow = window.innerHeight - rect.bottom;
    const placeBelow = spaceBelow > hintHeight + gap;

    const verticalOffset =
      step === 'create-task' && isTouchActive() && !placeBelow
        ? MOBILE_CREATE_TASK_HINT_VERTICAL_OFFSET
        : 0;
    const top = Math.max(
      8,
      placeBelow ? rect.bottom + gap : rect.top - hintHeight - gap + verticalOffset,
    );

    const halfTargetWidth = rect.width / 2;
    const halfHintWidth = hintWidth / 2;
    const targetCenter = rect.left + halfTargetWidth;
    const left = Math.min(
      Math.max(8, targetCenter - halfHintWidth),
      window.innerWidth - hintWidth - 8,
    );

    const arrowOffset = Math.max(12, Math.min(targetCenter - left, hintWidth - 12));
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
