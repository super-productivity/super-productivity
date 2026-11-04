import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { GlobalProgressBarService } from './global-progress-bar.service';

describe('GlobalProgressBarService', () => {
  let service: GlobalProgressBarService;
  let values: boolean[];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GlobalProgressBarService);
    values = [];
  });

  // RxJS delay(0) schedules a setInterval that fakeAsync only flushes with tick(1).
  const last = (): boolean | undefined => values[values.length - 1];

  it('shows while requests are pending and hides after the last one ends', fakeAsync(() => {
    const sub = service.isShowGlobalProgressBar$.subscribe((v) => values.push(v));
    TestBed.tick();
    tick(1);
    expect(last()).toBe(false);

    service.countUp();
    service.countUp();
    TestBed.tick();
    tick(1);
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
    const sub = service.isShowGlobalProgressBar$.subscribe((v) => values.push(v));
    service.countDown();
    service.countUp();
    TestBed.tick();
    tick(1);
    expect(last()).toBe(true);
    sub.unsubscribe();
  }));

  it('force-hides after 60s when a countDown was missed', fakeAsync(() => {
    const sub = service.isShowGlobalProgressBar$.subscribe((v) => values.push(v));
    service.countUp();
    TestBed.tick();
    tick(1);
    expect(last()).toBe(true);

    tick(60 * 1000);
    TestBed.tick();
    tick(200);
    expect(last()).toBe(false);
    sub.unsubscribe();
  }));
});
