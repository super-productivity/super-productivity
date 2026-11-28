import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { GlobalProgressBarService } from './global-progress-bar.service';

describe('GlobalProgressBarService', () => {
  let service: GlobalProgressBarService;
  let values: boolean[];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    values = [];
  });

  // The service is injected inside each fakeAsync zone: its constructor schedules
  // an RxJS delay(0) timer, and one created outside would be a real timer that
  // the later fake-clock ticks never flush (flaky). tick(10) flushes delay(0).
  const last = (): boolean | undefined => values[values.length - 1];

  it('shows while requests are pending and hides after the last one ends', fakeAsync(() => {
    service = TestBed.inject(GlobalProgressBarService);
    const sub = service.isShowGlobalProgressBar$.subscribe((v) => values.push(v));
    TestBed.tick();
    tick(10);
    expect(last()).toBe(false);

    service.countUp();
    service.countUp();
    TestBed.tick();
    tick(10);
    expect(last()).toBe(true);

    service.countDown();
    TestBed.tick();
    tick(200);
    expect(last()).toBe(true);

    service.countDown();
    TestBed.tick();
    tick(200);
    expect(last()).toBe(false);
    sub.unsubscribe();
  }));

  it('never counts below zero', fakeAsync(() => {
    service = TestBed.inject(GlobalProgressBarService);
    const sub = service.isShowGlobalProgressBar$.subscribe((v) => values.push(v));
    service.countDown();
    service.countUp();
    TestBed.tick();
    tick(10);
    expect(last()).toBe(true);
    sub.unsubscribe();
  }));

  it('force-hides after 60s when a countDown was missed', fakeAsync(() => {
    service = TestBed.inject(GlobalProgressBarService);
    const sub = service.isShowGlobalProgressBar$.subscribe((v) => values.push(v));
    service.countUp();
    TestBed.tick();
    tick(10);
    expect(last()).toBe(true);

    tick(60 * 1000);
    TestBed.tick();
    tick(200);
    expect(last()).toBe(false);
    sub.unsubscribe();
  }));
});
