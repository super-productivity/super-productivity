import { fromEvent, merge, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

/**
 * Emits when the page is hidden (tab switch, app backgrounding) or unloaded.
 * Persist in-memory state here: once hidden, a page may be killed without
 * further events. Async writes (IndexedDB) started during an unload itself
 * may not finish; only the hidden case gives them time to land.
 */
export const pageHidden$ = (): Observable<Event> =>
  merge(
    fromEvent(document, 'visibilitychange').pipe(
      filter(() => document.visibilityState === 'hidden'),
    ),
    fromEvent(window, 'pagehide'),
  );
