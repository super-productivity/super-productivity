import { animate, style, transition, trigger } from '@angular/animations';
import { ANI_ENTER_TIMING, ANI_FAST_TIMING, ANI_LEAVE_TIMING } from './animation.const';

export const expandAnimation = [
  trigger('expand', [
    transition(':enter', [
      style({ height: 0, overflow: 'hidden' }),
      animate(ANI_ENTER_TIMING, style({ height: '*' })),
    ]), // void => *
    transition(':leave', [
      style({ overflow: 'hidden' }),
      animate(ANI_LEAVE_TIMING, style({ height: 0 })),
    ]),
  ]),
];

export const expandInOnlyAnimation = [
  trigger('expandInOnly', [
    transition(':enter', [
      style({ height: 0, overflow: 'hidden' }),
      animate(ANI_ENTER_TIMING, style({ height: '*' })),
    ]),
  ]),
];

/**
 * The leave half of `expand`: for content that shows with its page. Padding,
 * border and margins collapse with the height, so a padded box (a callout)
 * doesn't stop at its padding and then jump away.
 */
export const expandOutOnlyAnimation = [
  trigger('expandOutOnly', [
    transition(':leave', [
      style({ overflow: 'hidden' }),
      animate(
        ANI_LEAVE_TIMING,
        style({
          height: 0,
          paddingTop: 0,
          paddingBottom: 0,
          borderTopWidth: 0,
          borderBottomWidth: 0,
          marginTop: 0,
          marginBottom: 0,
        }),
      ),
    ]),
  ]),
];

export const expandFadeAnimation = [
  trigger('expandFade', [
    transition(':enter', [
      style({ height: 0, opacity: 0, overflow: 'hidden' }),
      animate(ANI_ENTER_TIMING, style({ height: '*', opacity: 1 })),
    ]), // void => *
    transition(':leave', [
      style({ overflow: 'hidden', opacity: 1 }),
      animate(ANI_LEAVE_TIMING, style({ height: 0, opacity: 0 })),
    ]),
  ]),
];

export const expandFadeInOnlyAnimation = [
  trigger('expandFadeInOnly', [
    transition(':enter', [
      style({ height: 0, opacity: 0, overflow: 'hidden' }),
      animate(ANI_ENTER_TIMING, style({ height: '*', opacity: 1 })),
    ]), // void => *
    // transition(':leave', [
    //   style({overflow: 'hidden', opacity: 1}),
    //   animate(ANI_LEAVE_TIMING, style({height: 0, opacity: 0}))
    // ])
  ]),
];

export const expandFadeFastAnimation = [
  trigger('expandFadeFast', [
    transition(':enter', [
      style({ height: 0, opacity: 0, overflow: 'hidden' }),
      animate(ANI_FAST_TIMING, style({ height: '*', opacity: 1 })),
    ]), // void => *
    transition(':leave', [
      style({ overflow: 'hidden', opacity: 1 }),
      animate(ANI_FAST_TIMING, style({ height: 0, opacity: 0 })),
    ]),
  ]),
];

export const expandFadeHorizontalAnimation = [
  trigger('expandFadeHorizontal', [
    transition(':enter', [
      style({ width: 0, opacity: 0, overflow: 'hidden' }),
      animate(ANI_ENTER_TIMING, style({ width: '*', opacity: 1 })),
    ]), // void => *
    transition(':leave', [
      style({ overflow: 'hidden', opacity: 1 }),
      animate(ANI_LEAVE_TIMING, style({ width: 0, opacity: 0 })),
    ]),
  ]),
];
