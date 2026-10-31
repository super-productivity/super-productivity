import { Component, DoCheck } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PanDirective } from './pan.directive';

let checks = 0;

@Component({ selector: 'probe', standalone: true, template: '' })
class ProbeComponent implements DoCheck {
  ngDoCheck(): void {
    checks++;
  }
}

@Component({
  standalone: true,
  imports: [PanDirective, ProbeComponent],
  template: `<div
      panGesture
      (panleft)="onPan()"
    >
      {{ pans }}
    </div>
    <probe />`,
})
class HostComponent {
  pans = 0;

  onPan(): void {
    this.pans++;
  }
}

const fireTouch = (
  el: HTMLElement,
  type: 'touchstart' | 'touchmove',
  x: number,
  y: number,
): TouchEvent => {
  const ev = new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })],
  });
  el.dispatchEvent(ev);
  return ev;
};

describe('PanDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    el = fixture.nativeElement.querySelector('[panGesture]');
    checks = 0;
  });

  afterEach(() => fixture.destroy());

  it('does not run change detection for a vertical touch move', async () => {
    fireTouch(el, 'touchstart', 100, 100);
    fireTouch(el, 'touchmove', 100, 140);
    await fixture.whenStable();

    expect(checks).toBe(0);
    expect(fixture.componentInstance.pans).toBe(0);
  });

  it('emits a horizontal pan and runs change detection for it', async () => {
    fireTouch(el, 'touchstart', 100, 100);
    const move = fireTouch(el, 'touchmove', 70, 100);
    await fixture.whenStable();

    expect(fixture.componentInstance.pans).toBe(1);
    expect(move.defaultPrevented).toBeTrue();
    expect(checks).toBeGreaterThan(0);
    expect(el.textContent?.trim()).toBe('1');
  });
});
