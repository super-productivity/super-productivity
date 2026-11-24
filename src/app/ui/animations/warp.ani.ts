import { animate, animateChild, style, transition, trigger } from '@angular/animations';
import { ANI_ENTER_TIMING, ANI_LEAVE_TIMING } from './animation.const';

// A slight zoom: enough to read as the overlay arriving towards the viewer
// without the content visibly swelling.
const WARP_FROM = 'scale(1.05)';

export const warpAnimation = [
  trigger('warp', [
    transition(':enter', [
      style({ opacity: 0, transform: WARP_FROM }),
      animate(ANI_ENTER_TIMING, style({ opacity: 1, transform: 'scale(1)' })),
      animateChild(),
    ]),
    transition(':leave', [
      style({ opacity: 1, transform: 'scale(1)' }),
      animate(ANI_LEAVE_TIMING, style({ opacity: 0, transform: WARP_FROM })),
    ]),
  ]),
];

export const warpInAnimation = [
  trigger('warpIn', [
    transition(':enter', [
      style({ opacity: 0, transform: WARP_FROM }),
      animate(ANI_ENTER_TIMING, style({ opacity: 1, transform: 'scale(1)' })),
      animateChild(),
    ]),
  ]),
];
