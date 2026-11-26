import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { TimeHourTypeaheadDirective } from './time-hour-typeahead.directive';

@Component({
  template: `<input
    type="time"
    spTimeHourTypeahead
    [(ngModel)]="time"
  />`,
  imports: [TimeHourTypeaheadDirective, FormsModule],
  standalone: true,
})
class HostComponent {
  time = '09:30';
}

/**
 * Synthetic events don't drive Chromium's native time fields, so each step
 * replays what Chromium does for a typed digit: keydown, then the value it
 * computes, then `input`. The values were recorded in Chromium (#11252).
 */
const typeDigit = (
  el: HTMLInputElement,
  key: string,
  nativeValue: string,
  timeStamp: number,
): void => {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true });
  Object.defineProperty(ev, 'timeStamp', { value: timeStamp });
  el.dispatchEvent(ev);
  el.value = nativeValue;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('TimeHourTypeaheadDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let el: HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    el = fixture.debugElement.query(By.css('input')).nativeElement;
  });

  it('12h locale: typing 2215 sets 22:15 instead of 02:21 (#11252)', () => {
    // Chromium's 12h hour field jumps to minutes after "2", since 20 > 12
    typeDigit(el, '2', '02:30', 1000);
    typeDigit(el, '2', '02:02', 1100);
    expect(el.value).toBe('22:30');
    // the rewrite resets Chromium's field buffers, so minutes are typed fresh
    typeDigit(el, '1', '22:01', 1200);
    typeDigit(el, '5', '22:15', 1300);
    expect(el.value).toBe('22:15');
    expect(fixture.componentInstance.time).toBe('22:15');
  });

  it('12h locale: maps 20, 21 and 23 too', () => {
    [
      ['0', '02:00', '20:30'],
      ['1', '02:01', '21:30'],
      ['3', '02:03', '23:30'],
    ].forEach(([digit, nativeValue, expected], i) => {
      const startTs = (i + 1) * 10000;
      el.value = '09:30';
      typeDigit(el, '2', '02:30', startTs);
      typeDigit(el, digit, nativeValue, startTs + 100);
      expect(el.value).toBe(expected);
    });
  });

  it('24h locale: leaves the native 22:15 alone', () => {
    typeDigit(el, '2', '02:30', 1000);
    typeDigit(el, '2', '22:30', 1100);
    typeDigit(el, '1', '22:01', 1200);
    typeDigit(el, '5', '22:15', 1300);
    expect(el.value).toBe('22:15');
  });

  it('does not touch a digit above 3 typed into minutes', () => {
    typeDigit(el, '2', '02:30', 1000);
    typeDigit(el, '4', '02:04', 1100);
    expect(el.value).toBe('02:04');
  });

  it('does not treat "02" as a fresh hour 2', () => {
    typeDigit(el, '0', '09:30', 1000);
    typeDigit(el, '2', '02:30', 1100);
    typeDigit(el, '1', '02:01', 1200);
    expect(el.value).toBe('02:01');
  });

  it('ignores a second digit typed after the typeahead timeout', () => {
    typeDigit(el, '2', '02:30', 1000);
    typeDigit(el, '2', '02:02', 3000);
    expect(el.value).toBe('02:02');
  });
});
