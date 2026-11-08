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
  transition('disabled => disabled', []),
  transition('* => disabled', []),
  transition('disabled => *', []),
  transition('* <=> *', ANI),
  transition(':enter', []),
]);
