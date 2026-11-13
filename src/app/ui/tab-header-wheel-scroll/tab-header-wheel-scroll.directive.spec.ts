import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatTab, MatTabGroup } from '@angular/material/tabs';
import { TabHeaderWheelScrollDirective } from './tab-header-wheel-scroll.directive';

@Component({
  imports: [MatTabGroup, MatTab, TabHeaderWheelScrollDirective],
  template: `
    <div style="width: 240px">
      <mat-tab-group
        tabHeaderWheelScroll
        [mat-stretch-tabs]="false"
      >
        @for (label of labels; track label) {
          <mat-tab [label]="label">
            <div class="body">{{ label }}</div>
          </mat-tab>
        }
      </mat-tab-group>
    </div>
  `,
})
class HostComponent {
  labels = Array.from({ length: 8 }, (_, i) => `A rather long tab label ${i}`);
}

describe('TabHeaderWheelScrollDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let header: MatTabGroup['_tabHeader'];
  let headerEl: HTMLElement;

  const wheel = (
    target: EventTarget,
    init: WheelEventInit,
  ): { event: WheelEvent; prevented: boolean } => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    const notPrevented = target.dispatchEvent(event);
    return { event, prevented: !notPrevented };
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    header = fixture.debugElement.query((d) => d.componentInstance instanceof MatTabGroup)
      .componentInstance._tabHeader;
    headerEl = fixture.nativeElement.querySelector('.mat-mdc-tab-header');
  });

  it('paginates the header, so the test exercises the real overflow state', () => {
    expect(header._showPaginationControls).toBeTrue();
    expect(header.scrollDistance).toBe(0);
  });

  it('moves the header on a horizontal wheel gesture and consumes the event', () => {
    const { prevented } = wheel(headerEl.querySelector('.mat-mdc-tab-label-container')!, {
      deltaX: 80,
      deltaY: 2,
    });
    expect(header.scrollDistance).toBe(80);
    expect(prevented).toBeTrue();
  });

  it('scrolls back with a negative delta and clamps at the start', () => {
    wheel(headerEl, { deltaX: 80 });
    wheel(headerEl, { deltaX: -200 });
    expect(header.scrollDistance).toBe(0);
  });

  it('lets the page scroll once the strip cannot move further at either end', () => {
    const tabList: HTMLElement = headerEl.querySelector('.mat-mdc-tab-list')!;
    expect(wheel(headerEl, { deltaX: -40 }).prevented).toBeFalse();
    expect(tabList.style.transition).toBe('');
    wheel(headerEl, { deltaX: 100000 });
    const max = header.scrollDistance;
    expect(max).toBeGreaterThan(0);
    expect(wheel(headerEl, { deltaX: 40 }).prevented).toBeFalse();
    expect(header.scrollDistance).toBe(max);
  });

  it('ignores ctrl+wheel so pinch and keyboard zoom keep working', () => {
    const { prevented } = wheel(headerEl, { deltaX: 80, ctrlKey: true });
    expect(header.scrollDistance).toBe(0);
    expect(prevented).toBeFalse();
  });

  it('converts line and page deltas to pixels', () => {
    wheel(headerEl, { deltaX: 0, deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE });
    expect(header.scrollDistance).toBe(48);
    const container: HTMLElement = headerEl.querySelector(
      '.mat-mdc-tab-label-container',
    )!;
    wheel(headerEl, { deltaX: 0, deltaY: -1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
    expect(header.scrollDistance).toBe(Math.max(0, 48 - container.clientWidth));
  });

  it('suspends the header transition during a gesture and restores it afterwards', async () => {
    const tabList: HTMLElement = headerEl.querySelector('.mat-mdc-tab-list')!;
    wheel(headerEl, { deltaX: 20 });
    expect(tabList.style.transition).toBe('none');
    wheel(headerEl, { deltaX: 20 });
    await new Promise((r) => setTimeout(r, 250));
    expect(tabList.style.transition).toBe('');
    expect(header.scrollDistance).toBe(40);
  });

  it('scrolls the header with a vertical wheel and consumes the event', () => {
    const { prevented } = wheel(headerEl, { deltaX: 0, deltaY: 100 });
    expect(header.scrollDistance).toBe(100);
    expect(prevented).toBeTrue();
    wheel(headerEl, { deltaX: 0, deltaY: -100 });
    expect(header.scrollDistance).toBe(0);
  });

  it('follows the dominant axis of a diagonal gesture', () => {
    wheel(headerEl, { deltaX: 3, deltaY: 40 });
    expect(header.scrollDistance).toBe(40);
  });

  it('ignores horizontal gestures over the tab body', () => {
    const body = fixture.nativeElement.querySelector('.mat-mdc-tab-body-wrapper');
    const { prevented } = wheel(body, { deltaX: 80 });
    expect(header.scrollDistance).toBe(0);
    expect(prevented).toBeFalse();
  });
});
