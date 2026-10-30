import { Component } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { LongPressDirective } from './longpress.directive';
import { UI_LONG_PRESS_DURATION } from '../ui.const';

@Component({
  standalone: true,
  imports: [LongPressDirective],
  template: `<button (longPress)="presses = presses + 1">Slot</button>`,
})
class HostComponent {
  presses = 0;
}

const fireTouch = (
  el: HTMLElement,
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  x = 0,
  y = 0,
): void => {
  const touches =
    type === 'touchend' || type === 'touchcancel'
      ? []
      : [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })];
  el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches }));
};

describe('LongPressDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let el: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    el = fixture.nativeElement.querySelector('button');
  });

  afterEach(() => fixture.destroy());

  it('emits for a touch held in place', fakeAsync(() => {
    fireTouch(el, 'touchstart', 100, 100);
    tick(UI_LONG_PRESS_DURATION);

    expect(fixture.componentInstance.presses).toBe(1);
  }));

  it('tolerates a small jitter of the finger', fakeAsync(() => {
    fireTouch(el, 'touchstart', 100, 100);
    fireTouch(el, 'touchmove', 102, 101);
    tick(UI_LONG_PRESS_DURATION);

    expect(fixture.componentInstance.presses).toBe(1);
  }));

  it('does not emit when the finger slides away', fakeAsync(() => {
    fireTouch(el, 'touchstart', 100, 100);
    fireTouch(el, 'touchmove', 100, 290);
    tick(UI_LONG_PRESS_DURATION);

    expect(fixture.componentInstance.presses).toBe(0);
  }));

  it('does not emit when the touch is cancelled', fakeAsync(() => {
    fireTouch(el, 'touchstart', 100, 100);
    fireTouch(el, 'touchcancel');
    tick(UI_LONG_PRESS_DURATION);

    expect(fixture.componentInstance.presses).toBe(0);
  }));

  it('does not emit when the touch ends early', fakeAsync(() => {
    fireTouch(el, 'touchstart', 100, 100);
    tick(UI_LONG_PRESS_DURATION / 2);
    fireTouch(el, 'touchend');
    tick(UI_LONG_PRESS_DURATION);

    expect(fixture.componentInstance.presses).toBe(0);
  }));

  it('emits for a mouse button held down', fakeAsync(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    tick(UI_LONG_PRESS_DURATION);

    expect(fixture.componentInstance.presses).toBe(1);
  }));
});
