import { animate, style, transition, trigger } from '@angular/animations';
import { ANI_ENTER_TIMING } from '../../../ui/animations/animation.const';
import { PAGE_ENTER_FROM } from '../../../ui/animations/warp-route';

// Another task in the same panel: the content swap of a page change
// (`workViewProjectChangeAnimation` offset), not a slide across the panel's width.
const ANI = [
  style({ opacity: 0, transform: PAGE_ENTER_FROM }),
  animate(ANI_ENTER_TIMING, style({ opacity: 1, transform: 'none' })),
];

export const taskDetailPanelTaskChangeAnimation = trigger('taskDetailPanelTaskChange', [
  // Only a change BETWEEN tasks slides; opening and closing belong to the
  // container (right panel collapses its width, bottom sheet slides down).
  // Both aliases must stay above the wildcard: ':enter'/':leave' are just
  // 'void => *'/'* => void', and '*' matches void, so '* <=> *' would claim
  // them first — which played these enter keyframes on removal, jerking the
  // panel left while the bottom sheet was already sliding it down.
  transition(':enter', []),
  transition(':leave', []),
  transition('disabled => disabled', []),
  transition('* => disabled', []),
  transition('disabled => *', []),
  transition('* <=> *', ANI),
]);
