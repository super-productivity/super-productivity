import { animate, style, transition, trigger } from '@angular/animations';
import { ANI_ENTER_TIMING } from '../../ui/animations/animation.const';

/** Where the board starts its enter: the work view's project-change zoom. */
export const VIEW_SWITCH_FROM = 'scale(1.2)';
/** A view just created, on a phone: it comes in from the right, forward. */
export const VIEW_ARRIVAL_FROM_XS = 'translateX(25%)';

export interface ViewSwitchParams {
  /** The transform the board starts from. */
  from: string;
  /** A view just created arrives: it animates even when it enters. */
  isArrival: boolean;
}

/**
 * Switching from one view to another (also after Create or Duplicate on a
 * view page): the router reuses the page and the `<board>` element, so only
 * this state change on the view id can animate it. Same motion as the work
 * view's project change.
 *
 * Between two view ids only, unless a view was just created: on entering the
 * page `warpRoute` already animates it (and its `animateChild()` would replay
 * an `:enter` afterwards), and a leaving board must not animate. A created
 * view does enter, from the empty `/boards` page or after `warpRoute` brought
 * its page in, so it reads as somewhere new. No `animateChild()`, so the
 * board's own triggers don't replay after it.
 */
export const viewSwitchAnimation = [
  trigger('viewSwitch', [
    transition(
      (from: string, to: string, _el: unknown, params?: Partial<ViewSwitchParams>) =>
        to !== 'void' && (from !== 'void' || !!params?.isArrival),
      [
        style({ opacity: 0, transform: '{{ from }}' }),
        animate(ANI_ENTER_TIMING, style({ opacity: 1, transform: 'none' })),
      ],
      { params: { from: VIEW_SWITCH_FROM } },
    ),
  ]),
];
