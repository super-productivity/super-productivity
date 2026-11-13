import { InputDurationDirective } from './input-duration.directive';
import { ElementRef, Renderer2 } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { FormControl } from '@angular/forms';
import { StringToMsPipe } from './string-to-ms.pipe';
import { MsToStringPipe } from './ms-to-string.pipe';

describe('InputDurationDirective', () => {
  let directive: InputDurationDirective;
  let mockElementRef: ElementRef;
  let mockTranslateService: jasmine.SpyObj<TranslateService>;
  let mockRenderer: jasmine.SpyObj<Renderer2>;
  let mockStringToMsPipe: jasmine.SpyObj<StringToMsPipe>;
  let mockMsToStringPipe: jasmine.SpyObj<MsToStringPipe>;

  beforeEach(() => {
    mockElementRef = {
      nativeElement: document.createElement('input'),
    };

    mockTranslateService = jasmine.createSpyObj('TranslateService', ['instant']);
    mockTranslateService.instant.and.returnValue('Duration is required');

    mockRenderer = jasmine.createSpyObj('Renderer2', [
      'addClass',
      'removeClass',
      'setProperty',
      'setAttribute',
      'removeAttribute',
    ]);

    mockStringToMsPipe = jasmine.createSpyObj('StringToMsPipe', ['transform']);
    mockMsToStringPipe = jasmine.createSpyObj('MsToStringPipe', ['transform']);

    TestBed.configureTestingModule({
      providers: [
        InputDurationDirective,
        { provide: ElementRef, useValue: mockElementRef },
        { provide: TranslateService, useValue: mockTranslateService },
        { provide: Renderer2, useValue: mockRenderer },
        { provide: StringToMsPipe, useValue: mockStringToMsPipe },
        { provide: MsToStringPipe, useValue: mockMsToStringPipe },
      ],
    });

    directive = TestBed.inject(InputDurationDirective);
  });

  describe('onInput', () => {
    let onChangeSpy: jasmine.Spy;
    let errorSpy: jasmine.Spy;

    beforeEach(() => {
      // Initialize the directive
      directive.ngOnInit();

      // Setup spies
      onChangeSpy = jasmine.createSpy('onChange');
      directive.registerOnChange(onChangeSpy);

      errorSpy = spyOn(console, 'error');

      // Mock the pipes to simulate actual behavior
      mockStringToMsPipe.transform.and.callFake((str: string) => {
        // Simple mock implementation
        if (str === '2h 3m') return 7380000;
        if (str === '2h') return 7200000;
        if (str === '30m') return 1800000;
        if (str === '1h') return 3600000;
        if (str === '1h 30m') return 5400000;
        if (str === '0h' || str === '0m') return 0;
        return 0;
      });

      mockMsToStringPipe.transform.and.callFake((ms: number | null | undefined) => {
        if (ms === 7380000) return '2h 3m';
        if (ms === 7200000) return '2h';
        if (ms === 3600000) return '1h';
        if (ms === 5400000) return '1h 30m';
        if (ms === 1800000) return '30m';
        if (ms === 0) return '0m';
        return '';
      });
    });

    it('emits a re-entered value after the model changes externally', () => {
      directive.onInput('1h');
      directive.writeValue(7200000);
      onChangeSpy.calls.reset();

      directive.onInput('1h');

      expect(onChangeSpy).toHaveBeenCalledOnceWith(3600000);
    });

    it('should process "2h 3m" and parse as 2 hours 3 minutes', () => {
      directive.onInput('2h 3m');

      expect(onChangeSpy).toHaveBeenCalledWith(7380000);
    });

    it('should process "2h" and convert to 7200000 ms', () => {
      directive.onInput('2h');

      expect(onChangeSpy).toHaveBeenCalledWith(7200000);
    });

    it('should not process "45s" input (does not match allowed pattern)', () => {
      // The directive only accepts patterns like "1h", "2m", "3h 30m"
      directive.onInput('45s');

      expect(onChangeSpy).not.toHaveBeenCalled();
    });

    it('should not process "1d" input (does not match allowed pattern)', () => {
      directive.onInput('1d');

      expect(onChangeSpy).not.toHaveBeenCalled();
    });

    it('should not process empty input (does not match allowed pattern)', () => {
      directive.onInput('');

      expect(onChangeSpy).not.toHaveBeenCalled();
    });

    it('should not process invalid input (does not match allowed pattern)', () => {
      directive.onInput('invalid');

      expect(onChangeSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('validate', () => {
    it('should accept 0 as a valid duration value', () => {
      const control = new FormControl(0);
      const result = directive.validate(control);
      expect(result).toBeNull();
    });

    it('should accept positive numbers as valid duration values', () => {
      const control = new FormControl(3600000); // 1 hour in ms
      const result = directive.validate(control);
      expect(result).toBeNull();
    });

    it('should reject null values', () => {
      const control = new FormControl(null);
      const result = directive.validate(control);
      expect(result).toEqual({
        duration: {
          invalid: true,
          message: 'Duration is required',
        },
      });
    });

    it('should reject undefined values', () => {
      const control = new FormControl(undefined);
      const result = directive.validate(control);
      expect(result).toEqual({
        duration: {
          invalid: true,
          message: 'Duration is required',
        },
      });
    });

    it('should reject NaN values', () => {
      const control = new FormControl(NaN);
      const result = directive.validate(control);
      expect(result).toEqual({
        duration: {
          invalid: true,
          message: 'Duration is required',
        },
      });
    });

    it('should not validate when isValidate is false', () => {
      // Set up the directive to not validate
      spyOn(directive, 'isValidate').and.returnValue(false);

      const control = new FormControl(null);
      const result = directive.validate(control);
      expect(result).toBeNull();
    });
  });

  describe('input processing', () => {
    let onChangeSpy: jasmine.Spy;

    beforeEach(() => {
      // Initialize the directive
      directive.ngOnInit();

      // Spy on the onChange callback
      onChangeSpy = jasmine.createSpy('onChange');
      directive.registerOnChange(onChangeSpy);

      // Mock the pipes
      mockStringToMsPipe.transform.and.callFake((str: string) => {
        if (str === '1h') return 3600000;
        if (str === '30m') return 1800000;
        if (str === '1h 30m') return 5400000;
        if (str === '2h') return 7200000;
        if (str === '0h' || str === '0m') return 0;
        return 0;
      });

      mockMsToStringPipe.transform.and.callFake((ms: number | null | undefined) => {
        if (ms === 3600000) return '1h';
        if (ms === 1800000) return '30m';
        if (ms === 5400000) return '1h 30m';
        if (ms === 7200000) return '2h';
        if (ms === 0) return '0m';
        return '';
      });
    });

    it('should process and update value for valid input', () => {
      directive.onInput('1h');

      expect(onChangeSpy).toHaveBeenCalledWith(3600000);
    });

    it('should not update value when input does not match regex pattern', () => {
      directive.onInput('2h 3'); // User typing "2h 30m" but not finished

      expect(onChangeSpy).not.toHaveBeenCalled();
    });

    it('should handle zero values with units', () => {
      // These should process even if msToStr returns different format
      directive.onInput('0h');
      expect(onChangeSpy).toHaveBeenCalledWith(0);

      onChangeSpy.calls.reset();

      directive.onInput('0m');
      expect(onChangeSpy).toHaveBeenCalledWith(0);

      onChangeSpy.calls.reset();

      // '0s' doesn't match the main regex pattern, so it won't be processed
      directive.onInput('0s');
      expect(onChangeSpy).not.toHaveBeenCalled();
    });

    it('should handle empty string input', () => {
      directive.onInput('');

      expect(onChangeSpy).not.toHaveBeenCalled();
    });

    it('should not call onChange if value has not changed', () => {
      // First call sets the value
      directive.onInput('1h');
      expect(onChangeSpy).toHaveBeenCalledWith(3600000);

      onChangeSpy.calls.reset();

      // Second call with same value should not trigger onChange
      directive.onInput('1h');
      expect(onChangeSpy).not.toHaveBeenCalled();
    });

    it('should handle parsing errors gracefully', () => {
      directive.onInput('invalid');

      expect(onChangeSpy).not.toHaveBeenCalled();
    });

    it('should update value for various valid formats', () => {
      // Mock the conversion methods to simulate proper behavior
      const testCases = [
        { input: '30m', ms: 1800000 },
        { input: '1h', ms: 3600000 },
        { input: '1h 30m', ms: 5400000 },
        { input: '2h', ms: 7200000 },
      ];

      // These don't match the regex pattern
      const invalidTestCases = [{ input: '45s' }, { input: '1d' }];

      testCases.forEach(({ input, ms }) => {
        onChangeSpy.calls.reset();

        directive.onInput(input);

        expect(onChangeSpy).toHaveBeenCalledWith(ms);
      });

      invalidTestCases.forEach(({ input }) => {
        onChangeSpy.calls.reset();

        directive.onInput(input);

        expect(onChangeSpy).not.toHaveBeenCalled();
      });
    });
  });
});
