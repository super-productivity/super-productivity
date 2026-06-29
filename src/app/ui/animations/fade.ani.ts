import { animate, style, transition, trigger } from '@angular/animations';
import {
  ANI_ENTER_TIMING,
  ANI_ENTER_TIMING_,
  ANI_LEAVE_TIMING,
  ANI_VERY_LONG_TIMING,
  TRANSITION_DURATION_ENTER,
  TRANSITION_DURATION_LEAVE,
} from './animation.const';

export const fadeAnimation = [
  trigger('fade', [
    transition(':enter', [
      style({ opacity: 0 }),
      animate(ANI_ENTER_TIMING, style({ opacity: '*' })),
    ]), // void => *
    transition(':leave', [
      style({ opacity: '*' }),
      animate(ANI_LEAVE_TIMING, style({ opacity: 0 })),
    ]),
  ]),
];

export const fadeInOutBottomAnimation = [
  trigger('fadeInOutBottom', [
    transition(':enter', [
      style({ opacity: 0, transform: 'translateY(100%)' }),
      animate(ANI_ENTER_TIMING, style({ opacity: '*', transform: 'translateY(0)' })),
    ]), // void => *
    transition(':leave', [
      style({ opacity: '*', transform: 'translateY(0)' }),
      animate(ANI_LEAVE_TIMING, style({ opacity: 0, transform: 'translateY(100%)' })),
    ]),
  ]),
];

export const fadeOutAnimation = [
  trigger('fadeOut', [
    // transition(':enter', [
    // style({opacity: 0, transform: 'translateY(100%)'}),
    // animate(ANI_ENTER_TIMING, style({opacity: '*', transform: 'translateY(0)'}))
    // ]), // void => *
    transition(':leave', [
      style({ opacity: '*' }),
      animate(ANI_LEAVE_TIMING, style({ opacity: 0 })),
    ]),
  ]),
];

/**
 * Sequential cross-fade for swapping elements in the same spot: the leaving
 * element fades out first, then the entering element waits that out-duration
 * before fading in (so the two never overlap). Use on both the old and new
 * element of a swap.
 */
export const fadeSwapAnimation = [
  trigger('fadeSwap', [
    transition(':enter', [
      style({ opacity: 0 }),
      animate(
        `${TRANSITION_DURATION_ENTER} ${TRANSITION_DURATION_LEAVE} ${ANI_ENTER_TIMING_}`,
        style({ opacity: '*' }),
      ),
    ]),
    transition(':leave', [
      style({ opacity: '*' }),
      animate(ANI_LEAVE_TIMING, style({ opacity: 0 })),
    ]),
  ]),
];

export const fadeInAnimation = [
  trigger('fadeIn', [
    transition(':enter', [
      style({ opacity: 0 }),
      animate(ANI_ENTER_TIMING, style({ opacity: '*' })),
    ]), // void => *
  ]),
];

export const fadeInSlowAnimation = [
  trigger('fadeInSlow', [
    transition(':enter', [
      style({ opacity: 0 }),
      animate(ANI_VERY_LONG_TIMING, style({ opacity: '*' })),
    ]), // void => *
  ]),
];
