import { TestBed } from '@angular/core/testing';
import { DatePickerInputComponent } from './date-picker-input.component';
import { provideNativeDateAdapter } from '@angular/material/core';
import { TranslateModule } from '@ngx-translate/core';
import { provideMockStore } from '@ngrx/store/testing';

describe('DatePickerInputComponent', () => {
  let component: DatePickerInputComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DatePickerInputComponent, TranslateModule.forRoot()],
      providers: [provideNativeDateAdapter(), provideMockStore()],
    });
    const fixture = TestBed.createComponent(DatePickerInputComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('validateDate', () => {
    it('should return true for a valid date within default range', () => {
      const date = new Date(2026, 2, 18);
      expect(component.validateDate(date)).toBe(true);
    });

    it('should return true when min and max are explicitly undefined (issue #6860)', () => {
      // Reproduce the exact runtime condition: Angular passes undefined from
      // a template binding like [min]="props.min", overriding the signal default
      const fixture = TestBed.createComponent(DatePickerInputComponent);
      fixture.componentRef.setInput('min', undefined);
      fixture.componentRef.setInput('max', undefined);
      fixture.detectChanges();
      const comp = fixture.componentInstance;
      const date = new Date(2026, 2, 18);
      expect(comp.validateDate(date)).toBe(true);
    });

    it('should return false for a date before min', () => {
      const fixture = TestBed.createComponent(DatePickerInputComponent);
      fixture.componentRef.setInput('min', '2026-06-01');
      fixture.detectChanges();
      const comp = fixture.componentInstance;
      const date = new Date(2026, 0, 1);
      expect(comp.validateDate(date)).toBe(false);
    });

    it('should return false for a date after max', () => {
      const fixture = TestBed.createComponent(DatePickerInputComponent);
      fixture.componentRef.setInput('max', '2026-01-01');
      fixture.detectChanges();
      const comp = fixture.componentInstance;
      const date = new Date(2026, 5, 1);
      expect(comp.validateDate(date)).toBe(false);
    });
  });

  describe('onValueChange', () => {
    it('should emit the date when validation passes', () => {
      const spy = jasmine.createSpy('onChange');
      component.registerOnChange(spy);
      const date = new Date(2026, 2, 18);
      component.onValueChange(date);
      expect(spy).toHaveBeenCalledWith(date);
      expect(component.innerValue).toEqual(date);
    });

    it('should emit null when value is null', () => {
      const spy = jasmine.createSpy('onChange');
      component.registerOnChange(spy);
      component.onValueChange(null);
      expect(spy).toHaveBeenCalledWith(null);
      expect(component.innerValue).toBeNull();
    });

    it('should NOT convert valid dates to epoch (issue #6860)', () => {
      const spy = jasmine.createSpy('onChange');
      component.registerOnChange(spy);
      const date = new Date(2026, 2, 18);
      component.onValueChange(date);
      // The bug was: valid dates were rejected by validateDate when min/max
      // were undefined, causing onChange(null), which the formly parser
      // converted to '1970-01-01'
      expect(spy).not.toHaveBeenCalledWith(null);
      expect(spy).toHaveBeenCalledWith(date);
    });
  });

  describe('writeValue', () => {
    it('should set innerValue to null for falsy values', () => {
      component.writeValue(null);
      expect(component.innerValue).toBeNull();
    });

    it('should set innerValue for Date objects', () => {
      const date = new Date(2026, 2, 18);
      component.writeValue(date);
      expect(component.innerValue).toEqual(date);
    });

    it('should parse valid date strings', () => {
      component.writeValue('2026-03-18');
      expect(component.innerValue).toBeTruthy();
      expect(component.innerValue!.getFullYear()).toBe(2026);
      expect(component.innerValue!.getMonth()).toBe(2);
      expect(component.innerValue!.getDate()).toBe(18);
    });

    it('should set innerValue to null for non-string non-Date values', () => {
      component.writeValue(12345);
      expect(component.innerValue).toBeNull();
    });
  });
});
