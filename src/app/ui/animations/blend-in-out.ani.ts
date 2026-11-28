import { animate, style, transition, trigger } from '@angular/animations';
import { ANI_ENTER_TIMING, ANI_LEAVE_TIMING } from './animation.const';

// A small scale rather than a squash (`scaleY`), so the text keeps its shape
// while it fades.
const BLEND_FROM = 'scale(0.96)';

export const blendInOutAnimation = [
  trigger('blendInOut', [
    transition(':enter', [
      style({ opacity: 0, transform: BLEND_FROM }),
      animate(ANI_ENTER_TIMING, style({ opacity: 1, transform: 'none' })),
    ]),
    transition(':leave', [
      style({ opacity: 1, transform: 'none' }),
      animate(ANI_LEAVE_TIMING, style({ opacity: 0, transform: BLEND_FROM })),
    ]),
  ]),
];
