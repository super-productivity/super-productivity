import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InputDurationFormlyComponent } from './input-duration-formly.component';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { FormlyModule } from '@ngx-formly/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatInputModule } from '@angular/material/input';
import { TranslateModule } from '@ngx-translate/core';
import { StringToMsPipe } from '../string-to-ms.pipe';
import { MsToStringPipe } from '../ms-to-string.pipe';
import { InputDurationDirective } from '../input-duration.directive';

describe('InputDurationFormlyComponent', () => {
  let component: InputDurationFormlyComponent;
  let fixture: ComponentFixture<InputDurationFormlyComponent>;
  let formControl: FormControl;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        InputDurationFormlyComponent,
        ReactiveFormsModule,
        FormlyModule.forRoot(),
        BrowserAnimationsModule,
        MatInputModule,
        TranslateModule.forRoot(),
        InputDurationDirective,
        StringToMsPipe,
        MsToStringPipe,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InputDurationFormlyComponent);
    component = fixture.componentInstance;

    // Create a form control
    formControl = new FormControl();

    // Mock the formControl getter to return our test form control
    Object.defineProperty(component, 'formControl', {
      get: () => formControl,
      configurable: true,
    });

    // Set up the field configuration
    component.field = {
      key: 'duration',
      type: 'duration',
      props: {},
      templateOptions: {},
    } as any;

    fixture.detectChanges();
  });

  describe('onInputValueChange', () => {
    let setValueSpy: jasmine.Spy;

    beforeEach(() => {
      setValueSpy = spyOn(formControl, 'setValue');
    });

    it('should parse "2h" and convert to 7200000 milliseconds', (done) => {
      const event = {
        target: {
          value: '2h',
        },
      } as unknown as Event;

      component.onInputValueChange(event);

      setTimeout(() => {
        expect(setValueSpy).toHaveBeenCalledWith(7200000);
        done();
      }, 0);
    });

    it('should handle "45s" input', (done) => {
      const event = {
        target: {
          value: '45s',
        },
      } as unknown as Event;

      component.onInputValueChange(event);

      setTimeout(() => {
        expect(setValueSpy).toHaveBeenCalledWith(45000);
        done();
      }, 0);
    });

    it('should handle "1d" input', (done) => {
      const event = {
        target: {
          value: '1d',
        },
      } as unknown as Event;

      component.onInputValueChange(event);

      setTimeout(() => {
        expect(setValueSpy).toHaveBeenCalledWith(86400000);
        done();
      }, 0);
    });

    it('should handle empty input and set undefined', (done) => {
      const event = {
        target: {
          value: '',
        },
      } as unknown as Event;

      component.onInputValueChange(event);

      setTimeout(() => {
        expect(setValueSpy).toHaveBeenCalledWith(undefined);
        done();
      }, 0);
    });

    it('should parse "2h 3" as 2 hours and 3 minutes', (done) => {
      const event = {
        target: {
          value: '2h 3',
        },
      } as unknown as Event;

      component.onInputValueChange(event);

      setTimeout(() => {
        // stringToMs interprets '2h 3' as 2 hours and 3 minutes = 7380000 ms
        expect(setValueSpy).toHaveBeenCalledWith(7380000);
        done();
      }, 10);
    });
  });

  describe('ngOnDestroy', () => {
    it('should clear timeout on destroy', () => {
      spyOn(window, 'clearTimeout');

      // Set a timeout first
      (component as any)._timeout = 123;

      component.ngOnDestroy();

      expect(window.clearTimeout).toHaveBeenCalledWith(123);
    });

    it('should not call clearTimeout if no timeout is set', () => {
      spyOn(window, 'clearTimeout');

      component.ngOnDestroy();

      expect(window.clearTimeout).not.toHaveBeenCalled();
    });
  });
});
