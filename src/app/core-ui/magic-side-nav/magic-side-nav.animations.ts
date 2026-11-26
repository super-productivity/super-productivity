import { animate, state, style, transition, trigger } from '@angular/animations';
import { ANI_ENTER_TIMING, ANI_LEAVE_TIMING } from '../../ui/animations/animation.const';

const HIDE_CONTENT_PROP = CSS.supports('content-visibility', 'hidden')
  ? 'contentVisibility'
  : 'visibility';

export const magicSideNavAnimations = [
  // Mobile animation - slides from right
  // The closed drawer stays in the DOM. `content-visibility: hidden` keeps its
  // rows out of the tab order and the accessibility tree, and unlike
  // `visibility` it does not restyle the whole subtree on every toggle (~50ms at
  // 4x CPU throttling, #10820). iOS < 18 lacks it and gets `visibility`.
  trigger('mobileNavRight', [
    state(
      'hidden',
      style({ transform: 'translateX(100%)', [HIDE_CONTENT_PROP]: 'hidden' }),
    ),
    transition('void => visible, hidden => visible', [
      style({
        transform: 'translateX(100%)',
        opacity: 0,
        [HIDE_CONTENT_PROP]: 'visible',
      }),
      animate(ANI_ENTER_TIMING, style({ transform: 'translateX(0)', opacity: 1 })),
    ]),
    transition('visible => hidden, visible => void', [
      animate(ANI_LEAVE_TIMING, style({ transform: 'translateX(100%)' })),
    ]),
  ]),
  trigger('mobileBackdrop', [
    transition(':enter', [
      style({ opacity: 0 }),
      animate(ANI_ENTER_TIMING, style({ opacity: 1 })),
    ]),
    transition(':leave', [animate(ANI_LEAVE_TIMING, style({ opacity: 0 }))]),
  ]),
];
