import {
  animate,
  keyframes,
  query,
  stagger,
  style,
  transition,
  trigger,
} from '@angular/animations';
import { ANI_FAST_TIMING } from './animation.const';

// Items fade while their height opens or closes, clipped so their content
// never spills over the neighbours. Overflow stays hidden in every keyframe:
// it is discrete and would otherwise flip halfway through.
export const STANDARD_LIST_ANI = [
  query(':enter', style({ opacity: 0, height: 0, overflow: 'hidden' }), {
    optional: true,
  }),

  query(
    ':enter',
    stagger('40ms', [
      animate(
        ANI_FAST_TIMING,
        keyframes([
          style({ opacity: 0, height: 0, overflow: 'hidden', offset: 0 }),
          style({ opacity: 1, height: '*', overflow: 'hidden', offset: 0.99 }),
          style({ height: 'auto', overflow: 'hidden', offset: 1.0 }),
        ]),
      ),
    ]),
    { optional: true },
  ),

  query(
    ':leave',
    stagger('-40ms', [
      style({ opacity: 1, height: '*', overflow: 'hidden' }),
      animate(ANI_FAST_TIMING, style({ opacity: 0, height: 0, overflow: 'hidden' })),
    ]),
    { optional: true },
  ),
];

export const standardListAnimation = trigger('standardList', [
  transition(':increment, :decrement', STANDARD_LIST_ANI),
]);
