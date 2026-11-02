import { LiveAnnouncer } from '@angular/cdk/a11y';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { NAV_SECTION_ICON } from '../../../core-ui/magic-side-nav/nav-section-icons.const';
import { isTouchActive } from '../../../util/input-intent';
import { GlobalConfigService } from '../../config/global-config.service';
import { QuickTourService } from '../quick-tour.service';

/** The chip grows into the card, then the content fades in. */
const GROW_MS = 400;
const FADE_MS = 200;

const TEASERS = [
  { icon: NAV_SECTION_ICON.BOARDS, text: T.ONBOARDING.WANT_MORE.BOARDS },
  { icon: NAV_SECTION_ICON.HABITS, text: T.ONBOARDING.WANT_MORE.HABITS },
  { icon: 'center_focus_strong', text: T.ONBOARDING.WANT_MORE.FOCUS_MODE },
  { icon: NAV_SECTION_ICON.SCHEDULE, text: T.ONBOARDING.WANT_MORE.SCHEDULE },
  { icon: 'done_all', text: T.ONBOARDING.WANT_MORE.FINISH_DAY },
  { icon: 'extension', text: T.ONBOARDING.WANT_MORE.PLUGINS },
] as const;

/**
 * The tour's last step: what is there beyond the calm defaults. Only names
 * features and links to Settings; it switches nothing on itself.
 */
@Component({
  selector: 'quick-tour-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, MatIcon],
  templateUrl: './quick-tour-card.component.html',
  styleUrl: './quick-tour-card.component.scss',
})
export class QuickTourCardComponent {
  /** The chip the card grows from; none after a reload or a re-render. */
  readonly fromRect = input<DOMRect | null>(null);

  readonly T = T;
  readonly TEASERS = TEASERS;
  readonly quickTourService = inject(QuickTourService);

  private _globalConfigService = inject(GlobalConfigService);
  private _layoutService = inject(LayoutService);
  private _liveAnnouncer = inject(LiveAnnouncer);
  private _translateService = inject(TranslateService);
  private _cardEl = viewChild.required<ElementRef<HTMLElement>>('cardEl');
  private _contentEl = viewChild.required<ElementRef<HTMLElement>>('contentEl');

  readonly isPhone = this._layoutService.isShowMobileBottomNav;
  readonly isSyncLineShown = computed(() => !this._globalConfigService.sync()?.isEnabled);
  readonly searchKey = computed(
    () => this._globalConfigService.cfg()?.keyboard?.showSearchBar || null,
  );
  readonly isSearchShown = computed(
    () =>
      this._globalConfigService.appFeatures().isSearchEnabled &&
      (this.isPhone() || this.searchKey() !== null),
  );
  // Short syntax is typed on a keyboard; phones leave it out.
  readonly isShortSyntaxShown = computed(() => !this.isPhone() && !isTouchActive());

  constructor() {
    afterNextRender(() => {
      this._animateIn();
      void this._liveAnnouncer.announce(
        this._translateService.instant(T.ONBOARDING.WANT_MORE.TITLE),
      );
    });
  }

  private _animateIn(): void {
    const card = this._cardEl().nativeElement;
    const content = this._contentEl().nativeElement;
    // Element.animate is missing in some test/embedded environments.
    if (typeof card.animate !== 'function') {
      return;
    }
    const from = this.fromRect();
    const isReducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!from || isReducedMotion) {
      card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS });
      return;
    }
    const to = card.getBoundingClientRect();
    card.animate(
      [
        {
          transformOrigin: 'top left',
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${
            from.width / to.width
          }, ${from.height / to.height})`,
        },
        { transformOrigin: 'top left', transform: 'none' },
      ],
      { duration: GROW_MS, easing: 'ease-out' },
    );
    content.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_MS,
      delay: GROW_MS,
      fill: 'backwards',
    });
  }
}
