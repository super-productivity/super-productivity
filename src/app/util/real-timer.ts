import { lazySetInterval } from '../../../electron/shared-with-frontend/lazy-set-interval';
import { Observable } from 'rxjs';

export const realTimer$ = (intervalDuration: number): Observable<number> => {
  return new Observable((subscriber) => {
    const idleStart = Date.now();
    // subscriber.next(0);
    const cleanUp = lazySetInterval(() => {
      const delta = Date.now() - idleStart;
      subscriber.next(delta);
    }, intervalDuration);
    return cleanUp;
  });
};
