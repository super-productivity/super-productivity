import { fakeAsync, tick } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { pollWhileOnline } from './poll-while-online';

describe('pollWhileOnline', () => {
  let isOnline$: BehaviorSubject<boolean>;
  let trigger$: Subject<void>;
  let count: number;

  beforeEach(() => {
    isOnline$ = new BehaviorSubject<boolean>(true);
    trigger$ = new Subject<void>();
    count = 0;
  });

  it('passes trigger ticks while online', () => {
    const sub = pollWhileOnline(isOnline$, [trigger$]).subscribe(() => count++);
    trigger$.next();
    trigger$.next();
    expect(count).toBe(2);
    sub.unsubscribe();
  });

  it('drops trigger ticks while offline', () => {
    isOnline$.next(false);
    const sub = pollWhileOnline(isOnline$, [trigger$]).subscribe(() => count++);
    trigger$.next();
    expect(count).toBe(0);
    sub.unsubscribe();
  });

  it('does not tick for the initial online state', () => {
    const sub = pollWhileOnline(isOnline$, [trigger$]).subscribe(() => count++);
    expect(count).toBe(0);
    sub.unsubscribe();
  });

  it('ticks once when the connection comes back', () => {
    const sub = pollWhileOnline(isOnline$, [trigger$]).subscribe(() => count++);
    isOnline$.next(false);
    expect(count).toBe(0);
    isOnline$.next(true);
    expect(count).toBe(1);
    sub.unsubscribe();
  });

  it('delays the back-online tick and skips it if offline again by then', fakeAsync(() => {
    const sub = pollWhileOnline(isOnline$, [trigger$], 1000).subscribe(() => count++);
    isOnline$.next(false);
    isOnline$.next(true);
    tick(999);
    expect(count).toBe(0);
    tick(1);
    expect(count).toBe(1);

    isOnline$.next(false);
    isOnline$.next(true);
    isOnline$.next(false);
    tick(1000);
    expect(count).toBe(1);
    sub.unsubscribe();
  }));

  it('collapses reconnects within the delay into one tick', fakeAsync(() => {
    const sub = pollWhileOnline(isOnline$, [trigger$], 1000).subscribe(() => count++);
    isOnline$.next(false);
    isOnline$.next(true);
    tick(500);
    isOnline$.next(false);
    isOnline$.next(true);
    tick(1000);
    expect(count).toBe(1);
    sub.unsubscribe();
  }));
});
