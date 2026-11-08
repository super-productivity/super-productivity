import { animate, style, transition, trigger } from '@angular/animations';
import { ANI_ENTER_TIMING, ANI_LEAVE_TIMING } from '../animations/animation.const';

// Vertical margins collapse with the height so the content below does not jump
// when the element is inserted or removed. Overflow stays hidden in every
// keyframe: it is a discrete property and would flip halfway through, letting
// the items spill over the content below before being clipped.
const COLLAPSED = style({
  height: '0px',
  marginTop: '0px',
  marginBottom: '0px',
  overflow: 'hidden',
});
const EXPANDED = style({
  height: '*',
  marginTop: '*',
  marginBottom: '*',
  overflow: 'hidden',
});

export const expandCollapseAni = trigger('expandCollapse', [
  transition(':enter', [COLLAPSED, animate(ANI_ENTER_TIMING, EXPANDED)]),
  transition(':leave', [EXPANDED, animate(ANI_LEAVE_TIMING, COLLAPSED)]),
]);
