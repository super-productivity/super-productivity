import { Component, DebugElement } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TimeStepDirective } from './time-step.directive';

@Component({
  template: `<input
    type="time"
    spTimeStep
  />`,
  imports: [TimeStepDirective],
  standalone: true,
})
class TestHostComponent {}

const dispatchKey = (
  el: HTMLInputElement,
  key: string,
  modifiers: Partial<KeyboardEventInit> = {},
): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
};

describe('TimeStepDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let inputEl: DebugElement;
  let nativeInput: HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    inputEl = fixture.debugElement.query(By.css('input'));
    nativeInput = inputEl.nativeElement as HTMLInputElement;
    nativeInput.value = '09:00';
  });

  it('Shift+ArrowUp steps minutes by 5 (minute segment focused)', () => {
    dispatchKey(nativeInput, 'ArrowUp', { shiftKey: true });
    expect(nativeInput.value).toBe('09:05');
  });

  it('Shift+ArrowUp steps minutes by 5 even when hour segment is active', () => {
    nativeInput.value = '09:00';
    dispatchKey(nativeInput, 'ArrowUp', { shiftKey: true });
    expect(nativeInput.value).toBe('09:05');
  });

  it('Ctrl+ArrowUp steps minutes by 15', () => {
    nativeInput.value = '09:00';
    dispatchKey(nativeInput, 'ArrowUp', { ctrlKey: true });
    expect(nativeInput.value).toBe('09:15');
  });

  it('Meta+ArrowUp (Cmd on Mac) steps minutes by 15', () => {
    nativeInput.value = '09:00';
    dispatchKey(nativeInput, 'ArrowUp', { metaKey: true });
    expect(nativeInput.value).toBe('09:15');
  });

  it('Shift+ArrowDown wraps across hour boundary', () => {
    nativeInput.value = '09:00';
    dispatchKey(nativeInput, 'ArrowDown', { shiftKey: true });
    expect(nativeInput.value).toBe('08:55');
  });

  it('Ctrl+ArrowDown wraps past midnight', () => {
    nativeInput.value = '00:05';
    dispatchKey(nativeInput, 'ArrowDown', { ctrlKey: true });
    expect(nativeInput.value).toBe('23:50');
  });

  it('ArrowUp without modifier does not trigger directive', () => {
    nativeInput.value = '09:00';
    dispatchKey(nativeInput, 'ArrowUp');
    expect(nativeInput.value).toBe('09:00');
  });

  it('calls preventDefault when modifier is present', () => {
    const ev = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      shiftKey: true,
      bubbles: true,
    });
    const spy = spyOn(ev, 'preventDefault');
    nativeInput.dispatchEvent(ev);
    expect(spy).toHaveBeenCalled();
  });

  it('does not call preventDefault without modifier', () => {
    const ev = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
    const spy = spyOn(ev, 'preventDefault');
    nativeInput.dispatchEvent(ev);
    expect(spy).not.toHaveBeenCalled();
  });
});
