import { animate, style, transition, trigger } from '@angular/animations';
import { ANI_ENTER_TIMING } from '../../ui/animations/animation.const';
import { BoardCfg } from './boards.model';
import { getViewLayout } from './boards.util';

/** Where the board starts its enter: the work view's project-change zoom. */
export const VIEW_SWITCH_FROM = 'scale(1.2)';
/** A view just created, on a phone: it comes in from the right, forward. */
export const VIEW_ARRIVAL_FROM_XS = 'translateX(25%)';

export interface ViewSwitchParams {
  /** The transform the board starts from. */
  from: string;
  /** A view just created arrives: it animates even when it enters. */
  isArrival: boolean;
}

/**
 * The `viewSwitch` state of a view: its id and mode (nanoid and the default
 * ids have no `:`), so switching it between list and board animates too.
 */
export const getViewSwitchState = (board: Pick<BoardCfg, 'id' | 'cols'>): string =>
  `${board.id}:${getViewLayout(board)}`;

/**
 * Switching from one view to another (also after Create or Duplicate on a
 * view page): the router reuses the page and the `<board>` element, so only
 * this state change on the view id can animate it. Same motion as the work
 * view's project change. Switching a view between list and board (the title
 * bar's button, the editor or a synced edit) changes the state too, so it
 * enters the same way.
 *
 * Between two view ids only, unless a view was just created: on entering the
 * page `warpRoute` already animates it (and its `animateChild()` would replay
 * an `:enter` afterwards), and a leaving board must not animate. A created
 * view does enter from the empty `/boards` page (same page, no `warpRoute`),
 * so it reads as somewhere new. From another page the page itself arrives:
 * `AppComponent.getPage` reports `view-arrival` and `warpRoute` slides the page
 * in from the right; this enter is blocked there (its `.done` still clears the
 * arrival, which `warpRoute` lets settle without animating again). No
 * `animateChild()` here, so the board's own triggers don't replay after it.
 */
export const viewSwitchAnimation = [
  trigger('viewSwitch', [
    transition(
      (from: string, to: string, _el: unknown, params?: Partial<ViewSwitchParams>) =>
        to !== 'void' && (from !== 'void' || !!params?.isArrival),
      [
        style({ opacity: 0, transform: '{{ from }}' }),
        animate(ANI_ENTER_TIMING, style({ opacity: 1, transform: 'none' })),
      ],
      { params: { from: VIEW_SWITCH_FROM } },
    ),
  ]),
];
