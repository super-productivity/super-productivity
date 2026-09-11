import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DoneToggleComponent } from './done-toggle.component';

@Component({
  template: `<done-toggle [isDone]="true" />`,
  imports: [DoneToggleComponent],
})
class TestHostComponent {}

describe('DoneToggleComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;

  const getCheckStyle = (): CSSStyleDeclaration =>
    getComputedStyle(fixture.nativeElement.querySelector('.done-check'));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.body.classList.remove('isDisableAnimations');
  });

  // Regression test: `body.isDisableAnimations` (also set by the OS
  // reduced-motion preference) is `animation: none !important`, so `draw-check`
  // cannot reveal the checkmark. Without a resting `stroke-dashoffset: 0` the
  // whole polyline sits inside the dash gap and done tasks render as an empty
  // checkbox.
  it('draws the checkmark on a done task when animations are disabled', () => {
    document.body.classList.add('isDisableAnimations');

    const style = getCheckStyle();

    expect(style.animationName).toBe('none');
    expect(style.strokeDashoffset).toBe('0px');
  });

  // Positive control: the resting state must not stop the draw animation from
  // being applied when animations are on.
  it('still animates the checkmark when animations are enabled', () => {
    expect(getCheckStyle().animationName).toContain('draw-check');
  });
});
