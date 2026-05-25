import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { GlobalTrackingIntervalService } from './global-tracking-interval.service';
import { TRACKING_INTERVAL } from '../../app.constants';

describe('GlobalTrackingIntervalService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideMockStore({ initialState: {} })],
    });
  });

  it('should emit elapsed wall-clock time on tick$', fakeAsync(() => {
    const service = TestBed.inject(GlobalTrackingIntervalService);
    const durations: number[] = [];

    const sub = service.tick$.subscribe((emission) => durations.push(emission.duration));
    tick(TRACKING_INTERVAL);
    sub.unsubscribe();

    expect(durations).toEqual([TRACKING_INTERVAL]);
  }));

  it('should consume elapsed wall-clock time and reset the tracking start', fakeAsync(() => {
    const service = TestBed.inject(GlobalTrackingIntervalService);

    tick(1234);
    const first = service.consumeCurrentTick();
    tick(100);
    const second = service.consumeCurrentTick();

    expect(first.duration).toBe(1234);
    expect(second.duration).toBe(100);
  }));

  it('should avoid double-counting manually consumed time on the next tick', fakeAsync(() => {
    const service = TestBed.inject(GlobalTrackingIntervalService);
    const durations: number[] = [];

    tick(1234);
    expect(service.consumeCurrentTick().duration).toBe(1234);

    const sub = service.tick$.subscribe((emission) => durations.push(emission.duration));
    tick(TRACKING_INTERVAL);
    sub.unsubscribe();

    expect(durations.length).toBe(1);
    expect(durations[0]).toBeGreaterThan(0);
    expect(durations[0]).toBeLessThanOrEqual(TRACKING_INTERVAL);
  }));

  it('should cap wake-up tick delta and advance the tracking start by that amount', fakeAsync(() => {
    const service = TestBed.inject(GlobalTrackingIntervalService);

    tick(500);
    const wake = service.triggerWakeUpTick(200);

    expect(wake.duration).toBe(200);
    expect(service.consumeCurrentTick().duration).toBe(300);
  }));

  it('should emit an uncapped wake-up tick equal to elapsed wall-clock time', fakeAsync(() => {
    const service = TestBed.inject(GlobalTrackingIntervalService);

    tick(700);
    const wake = service.triggerWakeUpTick();

    expect(wake.duration).toBe(700);
    expect(service.consumeCurrentTick().duration).toBe(0);
  }));

  it('should push the wake-up tick onto tick$ for downstream consumers', fakeAsync(() => {
    const service = TestBed.inject(GlobalTrackingIntervalService);
    const observed: number[] = [];

    const sub = service.tick$.subscribe((emission) => observed.push(emission.duration));
    tick(400);
    service.triggerWakeUpTick(100);
    sub.unsubscribe();

    expect(observed).toContain(100);
  }));
});
