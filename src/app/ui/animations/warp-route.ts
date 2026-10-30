import {
  animate,
  animateChild,
  group,
  query,
  style,
  transition,
  trigger,
} from '@angular/animations';
import {
  ANI_ENTER_TIMING,
  ANI_LONG_TIMING,
  ANI_STANDARD_TIMING_,
  TRANSITION_DURATION_L,
  TRANSITION_DURATION_S,
} from './animation.const';

// starts shortly after the headline so the page still reads top to bottom
const CONTENT_FADE_TIMING = `${TRANSITION_DURATION_L} ${TRANSITION_DURATION_S} ${ANI_STANDARD_TIMING_}`;

export const warpRouteAnimation = trigger('warpRoute', [
  transition('* => daily-summary', [
    /* 1 */ query(
      ':enter, :leave',
      style({ position: 'absolute', width: '100%', minHeight: '100%', height: '100%' }),
      { optional: true },
    ),
    group([
      query(
        ':leave',
        [
          style({ opacity: 1, transform: 'scale(1)' }),
          animate(ANI_ENTER_TIMING, style({ opacity: 0, transform: 'scale(1.1)' })),
          animateChild(),
        ],
        { optional: true },
      ),
      query(
        ':enter',
        [
          style({ opacity: 0, transform: 'scale(1.2)' }),
          // One group so the content fades in while the headline does, instead
          // of the content appearing only after the headline has finished.
          group([
            animate(ANI_ENTER_TIMING, style({ opacity: 1, transform: 'scale(1)' })),
            query('h1', [
              style({ opacity: 0 }),
              animate(ANI_LONG_TIMING, style({ opacity: 1 })),
            ]),
            query(
              '.daily-summary-summary, .simple-counter-summary, .day-end-note, mat-tab-group',
              [
                style({ opacity: 0 }),
                animate(CONTENT_FADE_TIMING, style({ opacity: 1 })),
              ],
            ),
          ]),
          animateChild(),
        ],
        { optional: true },
      ),
    ]),
  ]),

  transition('* <=> *', [
    /* 1 */ query(
      ':enter, :leave',
      style({ position: 'absolute', width: '100%', minHeight: '100%', height: '100%' }),
      { optional: true },
    ),
    group([
      query(
        ':leave',
        [
          style({ opacity: 1, transform: 'scale(1)' }),
          animate(ANI_ENTER_TIMING, style({ opacity: 0, transform: 'scale(1.1)' })),
          animateChild(),
        ],
        { optional: true },
      ),
      query(
        ':enter',
        [
          style({ opacity: 0, transform: 'scale(1.2)' }),
          animate(ANI_ENTER_TIMING, style({ opacity: 1, transform: 'scale(1)' })),
          animateChild(),
        ],
        { optional: true },
      ),
    ]),
  ]),
]);
