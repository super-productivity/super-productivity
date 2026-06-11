import { ElementRef, Renderer2 } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InputTimeDirective } from './input-time.directive';

describe('InputTimeDirective', () => {
  let directive: InputTimeDirective;
  let nativeElement: { value: string; disabled: boolean };
  let renderer: jasmine.SpyObj<Renderer2>;

  beforeEach(() => {
    nativeElement = { value: '', disabled: false };
    renderer = jasmine.createSpyObj<Renderer2>('Renderer2', ['setProperty']);
    renderer.setProperty.and.callFake((_el: unknown, prop: string, val: unknown) => {
      (nativeElement as Record<string, unknown>)[prop] = val;
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: ElementRef, useValue: new ElementRef(nativeElement) },
        { provide: Renderer2, useValue: renderer },
      ],
    });

    directive = TestBed.runInInjectionContext(() => new InputTimeDirective());
  });

  describe('writeValue (model → display)', () => {
    it('zero-pads a legacy unpadded value for display', () => {
      directive.writeValue('9:00');
      expect(nativeElement.value).toBe('09:00');
    });

    it('passes through an already-padded value', () => {
      directive.writeValue('17:00');
      expect(nativeElement.value).toBe('17:00');
    });

    it('clears the display for an empty/invalid value', () => {
      directive.writeValue(null);
      expect(nativeElement.value).toBe('');
    });

    it('does NOT re-emit when only displaying a legacy value (no spurious change)', () => {
      const onChange = jasmine.createSpy('onChange');
      directive.registerOnChange(onChange);

      directive.writeValue('9:00');

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('onInput (display → model)', () => {
    it('emits the canonical HH:mm the native control provides', () => {
      const onChange = jasmine.createSpy('onChange');
      directive.registerOnChange(onChange);

      directive.onInput('13:45');

      expect(onChange).toHaveBeenCalledWith('13:45');
    });

    it('strips a stray seconds segment before emitting', () => {
      const onChange = jasmine.createSpy('onChange');
      directive.registerOnChange(onChange);

      directive.onInput('13:45:30');

      expect(onChange).toHaveBeenCalledWith('13:45');
    });

    it('emits an empty string when the field is cleared', () => {
      const onChange = jasmine.createSpy('onChange');
      directive.registerOnChange(onChange);

      directive.onInput('');

      expect(onChange).toHaveBeenCalledWith('');
    });
  });

  it('reflects the disabled state onto the element', () => {
    directive.setDisabledState(true);
    expect(nativeElement.disabled).toBe(true);
  });
});
