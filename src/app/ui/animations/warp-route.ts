import {
  animate,
  AnimationMetadata,
  group,
  query,
  style,
  transition,
  trigger,
} from '@angular/animations';
import {
  ANI_ENTER_TIMING,
  ANI_ENTER_TIMING_,
  ANI_LONG_TIMING,
  ANI_STANDARD_TIMING_,
  TRANSITION_DURATION_L,
  TRANSITION_DURATION_S,
} from './animation.const';

/**
 * Where a page starts its enter: a short rise, the same one the cold-start
 * entrance settles from (`entrance-settle`, app.component.scss). A translate
 * rather than a zoom: it never re-rasterizes the page, and the page keeps its
 * real size while it moves, so a rect read mid-enter is off by at most this
 * offset instead of a scale factor.
 */
export const PAGE_ENTER_FROM = 'translateY(8px)';

/**
 * Fade-through: the leaving page is gone before the entering one is more than
 * faintly visible, so two pages never show through each other (a crossfade of
 * two full task lists reads as a double exposure for most of its run). The
 * enter starts while the leave finishes, so the whole change still takes no
 * longer than one standard transition (225ms).
 */
export const PAGE_LEAVE_TIMING = `75ms ${ANI_STANDARD_TIMING_}`;
const PAGE_ENTER_TIMING = `180ms 45ms ${ANI_ENTER_TIMING_}`;
/**
 * The same enter where nothing leaves alongside it (a reused page swapping its
 * content, e.g. one project for another), so it need not wait for a leave.
 */
export const PAGE_SWITCH_TIMING = `180ms ${ANI_ENTER_TIMING_}`;

// starts shortly after the headline so the page still reads top to bottom
const CONTENT_FADE_TIMING = `${TRANSITION_DURATION_L} ${TRANSITION_DURATION_S} ${ANI_STANDARD_TIMING_}`;

// Both pages sit on top of each other while they animate.
const STACK_PAGES = query(
  ':enter, :leave',
  style({ position: 'absolute', width: '100%', minHeight: '100%', height: '100%' }),
  { optional: true },
);

// The faded page stays in the DOM, under the entering one, until the whole
// transition ends. Triggers inside either page don't run with it: Angular
// blocks a child's transition while an ancestor animates in the same pass (its
// `.done` still fires). `animateChild()` would only run triggers bound on the
// page host itself, and no page has one, so there is none here.
const LEAVE_PAGE = query(
  ':leave',
  [style({ opacity: 1 }), animate(PAGE_LEAVE_TIMING, style({ opacity: 0 }))],
  { optional: true },
);

const enterPage = (...alongside: AnimationMetadata[]): AnimationMetadata =>
  query(
    ':enter',
    [
      style({ opacity: 0, transform: PAGE_ENTER_FROM }),
      group([
        animate(PAGE_ENTER_TIMING, style({ opacity: 1, transform: 'none' })),
        ...alongside,
      ]),
    ],
    { optional: true },
  );

export const warpRouteAnimation = trigger('warpRoute', [
  transition('* => daily-summary', [
    STACK_PAGES,
    group([
      LEAVE_PAGE,
      // The content fades in while the headline does, instead of appearing
      // only after the headline has finished.
      enterPage(
        query('h1', [
          style({ opacity: 0 }),
          animate(ANI_LONG_TIMING, style({ opacity: 1 })),
        ]),
        query(
          '.daily-summary-summary, .simple-counter-summary, .day-end-note, mat-tab-group',
          [style({ opacity: 0 }), animate(CONTENT_FADE_TIMING, style({ opacity: 1 }))],
        ),
      ),
    ]),
  ]),

  // A view just created from another page (e.g. Save as view… on a task
  // list): the page moves forward, from the right, so it reads as somewhere
  // new. Within the view page (creating from a view, the empty /boards page)
  // the board's own `viewSwitch` arrival runs instead, and the state settling
  // back to `boards` afterwards must not animate the page again.
  transition('boards => view-arrival, view-arrival => boards', []),
  transition('* => view-arrival', [
    STACK_PAGES,
    group([
      query(
        ':leave',
        [
          style({ opacity: 1, transform: 'none' }),
          animate(ANI_ENTER_TIMING, style({ opacity: 0, transform: 'translateX(-10%)' })),
        ],
        { optional: true },
      ),
      query(
        ':enter',
        [
          style({ opacity: 0, transform: 'translateX(25%)' }),
          animate(ANI_ENTER_TIMING, style({ opacity: 1, transform: 'none' })),
        ],
        { optional: true },
      ),
    ]),
  ]),

  transition('* <=> *', [STACK_PAGES, group([LEAVE_PAGE, enterPage()])]),
]);
