import { animate, style, transition, trigger } from '@angular/animations';
import { ANI_ENTER_TIMING } from '../../ui/animations/animation.const';

/**
 * Switching from one view to another (also after Create or Duplicate on a
 * view page): the router reuses the page and the `<board>` element, so only
 * this state change on the view id can animate it. Same motion as the work
 * view's project change.
 *
 * Between two view ids only: on entering the page `warpRoute` already animates
 * it (and its `animateChild()` would replay an `:enter` afterwards), and a
 * leaving board must not animate. No `animateChild()`, so the board's own
 * triggers don't replay after it.
 */
export const viewSwitchAnimation = [
  trigger('viewSwitch', [
    transition(
      (from: string, to: string) => from !== 'void' && to !== 'void',
      [
        style({ opacity: 0, transform: 'scale(1.2)' }),
        animate(ANI_ENTER_TIMING, style({ opacity: 1, transform: 'scale(1)' })),
      ],
    ),
  ]),
];
