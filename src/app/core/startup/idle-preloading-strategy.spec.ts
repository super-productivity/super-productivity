import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  IdlePreloadingStrategy,
  PRELOAD_DELAY_MS,
  PRELOAD_IDLE_TIMEOUT_MS,
} from './idle-preloading-strategy';

describe('IdlePreloadingStrategy', () => {
  let strategy: IdlePreloadingStrategy;
  let idleSpy: jasmine.Spy;

  const flushIdle = (): void => {
    idleSpy.calls.mostRecent().args[0]({} as IdleDeadline);
  };

  beforeEach(() => {
    idleSpy = spyOn(window, 'requestIdleCallback').and.returnValue(1);
    strategy = TestBed.inject(IdlePreloadingStrategy);
  });

  it('does not load before the delay and the next idle period', fakeAsync(() => {
    const load = jasmine.createSpy('load').and.returnValue(of(true));

    strategy.preload({}, load).subscribe();
    tick(PRELOAD_DELAY_MS - 1);
    expect(idleSpy).not.toHaveBeenCalled();

    tick(1);
    expect(idleSpy).toHaveBeenCalledOnceWith(jasmine.any(Function), {
      timeout: PRELOAD_IDLE_TIMEOUT_MS,
    });
    expect(load).not.toHaveBeenCalled();

    flushIdle();
    expect(load).toHaveBeenCalledTimes(1);
  }));

  it('shares one wait across routes and loads later routes right away', fakeAsync(() => {
    const loadA = jasmine.createSpy('loadA').and.returnValue(of(true));
    const loadB = jasmine.createSpy('loadB').and.returnValue(of(true));
    const loadC = jasmine.createSpy('loadC').and.returnValue(of(true));

    strategy.preload({}, loadA).subscribe();
    strategy.preload({}, loadB).subscribe();
    tick(PRELOAD_DELAY_MS);
    flushIdle();

    expect(idleSpy).toHaveBeenCalledTimes(1);
    expect(loadA).toHaveBeenCalledTimes(1);
    expect(loadB).toHaveBeenCalledTimes(1);

    strategy.preload({}, loadC).subscribe();
    expect(loadC).toHaveBeenCalledTimes(1);
  }));

  it('skips the load of an unsubscribed preload but keeps the shared wait', fakeAsync(() => {
    const loadA = jasmine.createSpy('loadA').and.returnValue(of(true));
    const loadB = jasmine.createSpy('loadB').and.returnValue(of(true));

    strategy.preload({}, loadA).subscribe().unsubscribe();
    tick(PRELOAD_DELAY_MS);
    flushIdle();
    expect(loadA).not.toHaveBeenCalled();

    strategy.preload({}, loadB).subscribe();
    expect(loadB).toHaveBeenCalledTimes(1);
  }));

  it('loads right after the delay without requestIdleCallback (iOS)', fakeAsync(() => {
    const win = window as unknown as { requestIdleCallback?: unknown };
    const original = win.requestIdleCallback;
    win.requestIdleCallback = undefined;
    try {
      const load = jasmine.createSpy('load').and.returnValue(of(true));

      strategy.preload({}, load).subscribe();
      tick(PRELOAD_DELAY_MS - 1);
      expect(load).not.toHaveBeenCalled();

      tick(1);
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      win.requestIdleCallback = original;
    }
  }));

  it('swallows a failed load like PreloadAllModules', fakeAsync(() => {
    const load = jasmine
      .createSpy('load')
      .and.returnValue(throwError(() => new Error('chunk load failed')));
    const next = jasmine.createSpy('next');
    const error = jasmine.createSpy('error');

    strategy.preload({}, load).subscribe({ next, error });
    tick(PRELOAD_DELAY_MS);
    flushIdle();

    expect(load).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnceWith(null);
  }));
});
