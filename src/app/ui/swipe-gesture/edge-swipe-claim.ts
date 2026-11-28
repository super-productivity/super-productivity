/**
 * A touchstart the mobile drawer's edge swipe (#4464) has taken. The drawer
 * listens on the document in the capture phase, so it marks the event before
 * any element sees it; PanDirective (task swipe-block) then leaves the touch
 * alone instead of panning under the opening drawer. Nothing is stopped, so
 * every other listener (long-press, CDK drag, scrolling) still gets the touch.
 */
const claimedTouchStarts = new WeakSet<Event>();

export const claimTouchStartForEdgeSwipe = (event: Event): void => {
  claimedTouchStarts.add(event);
};

export const isTouchStartClaimedByEdgeSwipe = (event: Event): boolean =>
  claimedTouchStarts.has(event);
