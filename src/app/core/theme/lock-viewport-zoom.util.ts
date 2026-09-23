const ZOOM_LOCK = 'maximum-scale=1, user-scalable=no';

/**
 * Stop the page zooming on double-tap and on focusing a sub-16px input, by
 * appending `maximum-scale=1, user-scalable=no` to the viewport meta while
 * keeping its other directives (`viewport-fit=cover` is load-bearing, see
 * index.html).
 *
 * Only for the native iOS app (#10129): #9272 dropped these directives from the
 * shared meta to restore pinch-zoom, but in the iOS app Capacitor already
 * disables pinch (`zoomEnabled` defaults to false). It does so by switching the
 * pinch recognizer off once a pinch begins, which leaves double-tap zoom
 * working and a user who got zoomed in by it without a way to pinch back out.
 * WKWebView honours `user-scalable=no` (unlike Safari), so this turns off the
 * zoom gestures that are left without taking away any that worked.
 */
export const lockViewportZoom = (doc: Document): void => {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta || meta.content.includes('user-scalable')) {
    return;
  }
  meta.content = meta.content ? `${meta.content}, ${ZOOM_LOCK}` : ZOOM_LOCK;
};
