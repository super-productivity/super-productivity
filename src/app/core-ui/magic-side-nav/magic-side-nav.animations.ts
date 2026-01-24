import { animate, style, transition, trigger } from '@angular/animations';
import { ANI_ENTER_TIMING, ANI_LEAVE_TIMING } from '../../ui/animations/animation.const';

export const magicSideNavAnimations = [
  // Desktop animation - slides from left
  trigger('mobileNav', [
    transition(':enter', [
      style({ transform: 'translateX(-100%)', opacity: 0 }),
      animate(ANI_ENTER_TIMING, style({ transform: 'translateX(0)', opacity: 1 })),
    ]),
    transition(':leave', [
      animate(ANI_LEAVE_TIMING, style({ transform: 'translateX(-100%)' })),
    ]),
  ]),
  // Mobile animation - slides from right
  trigger('mobileNavRight', [
    transition(':enter', [
      style({ transform: 'translateX(100%)', opacity: 0 }),
      animate(ANI_ENTER_TIMING, style({ transform: 'translateX(0)', opacity: 1 })),
    ]),
    transition(':leave', [
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
