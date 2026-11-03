import { animate, style, transition, trigger } from '@angular/animations';
import { PAGE_ENTER_FROM, PAGE_LEAVE_TIMING, PAGE_SWITCH_TIMING } from './warp-route';

/**
 * Switching from one work context to another (project to project, tag to tag):
 * the router reuses the page, and the work view re-creates its content
 * (`isContextChangingWithDelay$`), so this is the only motion the switch gets.
 * Same motion as a page change (`warpRoute`). No `animateChild()`: the lists'
 * own enter motions would replay after this one.
 */
export const workViewProjectChangeAnimation = [
  trigger('projectChange', [
    transition(':enter', [
      style({ opacity: 0, transform: PAGE_ENTER_FROM }),
      animate(PAGE_SWITCH_TIMING, style({ opacity: 1, transform: 'none' })),
    ]),
    transition(':leave', [
      style({ opacity: 1 }),
      animate(PAGE_LEAVE_TIMING, style({ opacity: 0 })),
    ]),
  ]),
];
