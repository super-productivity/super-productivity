import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { InputColorPickerComponent } from './input-color-picker.component';
import { PRESET_COLORS } from '../work-context-color';

/**
 * The wrapper mimics the themed dialog surface from #9423: `backdrop-filter`
 * makes an element the containing block for fixed-position descendants, so a
 * panel positioned with viewport coordinates lands offset by the wrapper's own
 * origin. Three built-in themes do exactly this to `.mat-mdc-dialog-surface`.
 */
@Component({
  template: `
    <div class="offset-container">
      <input-color-picker
        [value]="color()"
        (valueChange)="color.set($event)"
      />
    </div>
  `,
  styles: [
    `
      /* Fixed, not absolute: the trigger's viewport rect must not depend on
         how far the Karma page happens to be scrolled in a full-suite run. */
      .offset-container {
        position: fixed;
        top: 220px;
        left: 260px;
        backdrop-filter: blur(20px);
      }
    `,
  ],
  imports: [InputColorPickerComponent],
})
class TestHostComponent {
  readonly color = signal(PRESET_COLORS[0]);
}

describe('InputColorPickerComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let picker: InputColorPickerComponent;

  const trigger = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('.color-trigger');
  const panel = (): HTMLElement | null => document.querySelector('.color-panel');
  const swatches = (): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll('.color-panel .color-swatch'));

  const open = (): void => {
    trigger().click();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent, NoopAnimationsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    picker = fixture.debugElement.children[0].children[0]
      .componentInstance as InputColorPickerComponent;
  });

  it('should not render the panel until opened', () => {
    expect(panel()).toBeNull();
  });

  it('should render the panel in the CDK overlay container, not inside the component', () => {
    open();

    const el = panel();
    expect(el).not.toBeNull();
    expect(el!.closest('.cdk-overlay-container')).not.toBeNull();
    expect(fixture.nativeElement.contains(el)).toBe(false);
  });

  // Regression test for #9423.
  it('should position the panel against the trigger when an ancestor establishes a containing block', () => {
    open();

    const triggerRect = trigger().getBoundingClientRect();
    const panelRect = panel()!.getBoundingClientRect();

    expect(panelRect.left).toBeCloseTo(triggerRect.left, 0);

    const isBelow = Math.abs(panelRect.top - triggerRect.bottom) <= 8;
    const isAbove = Math.abs(panelRect.bottom - triggerRect.top) <= 8;
    expect(isBelow || isAbove).toBe(true);

    expect(panelRect.top).toBeGreaterThanOrEqual(0);
    expect(panelRect.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(panelRect.right).toBeLessThanOrEqual(window.innerWidth);
  });

  it('should toggle closed when the trigger is clicked again', () => {
    open();
    expect(picker.isOpen()).toBe(true);

    open();

    expect(picker.isOpen()).toBe(false);
    expect(panel()).toBeNull();
  });

  it('should emit the picked preset and close', () => {
    open();
    const target = PRESET_COLORS[3];

    swatches()[3].click();
    fixture.detectChanges();

    expect(fixture.componentInstance.color()).toBe(target);
    expect(picker.isOpen()).toBe(false);
  });

  it('should close on escape without needing focus inside the panel', () => {
    open();

    // CDK's overlay keyboard dispatcher listens on `body` and reads `keyCode`.
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        keyCode: 27,
        bubbles: true,
        cancelable: true,
      } as KeyboardEventInit & { keyCode: number }),
    );
    fixture.detectChanges();

    expect(picker.isOpen()).toBe(false);
    expect(panel()).toBeNull();
  });

  it('should close the panel and delegate to the native input for a custom color', () => {
    open();
    const nativeInput = picker.nativeInput()!.nativeElement;
    const clickSpy = spyOn(nativeInput, 'click');

    swatches()[swatches().length - 1].click();
    fixture.detectChanges();

    expect(clickSpy).toHaveBeenCalled();
    expect(picker.isOpen()).toBe(false);
  });
});
