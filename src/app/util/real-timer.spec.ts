import { fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { Subscription } from 'rxjs';
import { realTimer$ } from './real-timer';

describe('realTimer$', () => {
  it('emits increasing delta values', fakeAsync(() => {
    const values: number[] = [];
    const sub: Subscription = realTimer$(1000).subscribe((v) => values.push(v));

    tick(1000);
    expect(values.length).toBe(1);
    expect(values[0]).toBeGreaterThanOrEqual(1000);

    tick(1000);
    expect(values.length).toBe(2);
    expect(values[1]).toBeGreaterThanOrEqual(2000);

    sub.unsubscribe();
    discardPeriodicTasks();
  }));

  it('cleans up on unsubscribe', fakeAsync(() => {
    spyOn(globalThis, 'clearTimeout').and.callThrough();

    const sub: Subscription = realTimer$(1000).subscribe();
    tick(1000);

    sub.unsubscribe();
    expect(globalThis.clearTimeout).toHaveBeenCalled();

    discardPeriodicTasks();
  }));

  it('stops emitting after unsubscribe', fakeAsync(() => {
    const values: number[] = [];
    const sub: Subscription = realTimer$(1000).subscribe((v) => values.push(v));

    tick(1000);
    const countAfterFirstTick = values.length;
    expect(countAfterFirstTick).toBe(1);

    sub.unsubscribe();

    tick(3000);
    expect(values.length).toBe(countAfterFirstTick);

    discardPeriodicTasks();
  }));
});
