import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InputTimeFormlyComponent } from './input-time-formly.component';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatInputModule } from '@angular/material/input';
import { signal } from '@angular/core';
import { DateAdapter, MatNativeDateModule } from '@angular/material/core';
import { TranslateService } from '@ngx-translate/core';
import { CustomDateAdapter } from '../../../core/date-time-format/custom-date-adapter';
import {
  DateTimeFormatService,
  SYSTEM_USES_24H_CLOCK,
} from '../../../core/date-time-format/date-time-format.service';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { DateTimeLocales } from '../../../core/locale.constants';

describe('InputTimeFormlyComponent', () => {
  let component: InputTimeFormlyComponent;
  let fixture: ComponentFixture<InputTimeFormlyComponent>;
  let formControl: FormControl;

  const getInput = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('input[type=time]');

  const setup = async (
    initialValue: string | null,
    clock: { uiLang: string; dateTimeLocale: string } = {
      uiLang: 'en',
      dateTimeLocale: DateTimeLocales.en_us,
    },
  ): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [
        InputTimeFormlyComponent,
        ReactiveFormsModule,
        FormlyModule.forRoot(),
        BrowserAnimationsModule,
        MatInputModule,
        MatNativeDateModule,
      ],
      providers: [
        { provide: DateAdapter, useClass: CustomDateAdapter },
        {
          provide: GlobalConfigService,
          useValue: { localization: signal({ dateTimeLocale: clock.dateTimeLocale }) },
        },
        {
          provide: TranslateService,
          useValue: { currentLang: clock.uiLang, defaultLang: 'en' },
        },
        // the native time input would render 12h AM/PM here
        { provide: SYSTEM_USES_24H_CLOCK, useValue: false },
      ],
    }).compileComponents();
    TestBed.inject(DateTimeFormatService).setUiLanguage(clock.uiLang);

    fixture = TestBed.createComponent(InputTimeFormlyComponent);
    component = fixture.componentInstance;

    formControl = new FormControl(initialValue);
    Object.defineProperty(component, 'formControl', {
      get: () => formControl,
      configurable: true,
    });
    component.field = {
      key: 'workStart',
      type: 'time',
      props: {},
      templateOptions: {},
    } as FormlyFieldConfig;

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('renders a native time input', async () => {
    await setup('09:00');
    expect(getInput()).toBeTruthy();
  });

  it('displays a legacy unpadded model value zero-padded', async () => {
    await setup('9:00');
    expect(getInput().value).toBe('09:00');
  });

  it('writes the canonical HH:mm back to the model on input', async () => {
    await setup('09:00');
    const input = getInput();
    input.value = '17:30';
    input.dispatchEvent(new Event('input'));
    expect(formControl.value).toBe('17:30');
  });

  it('clears the model when the field is emptied', async () => {
    await setup('09:00');
    const input = getInput();
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(formControl.value).toBe('');
  });

  ['en', 'de'].forEach((uiLang) => {
    describe(`with ISO 8601 (24h) on a 12h system and a "${uiLang}" UI (#8565)`, () => {
      const iso = { uiLang, dateTimeLocale: DateTimeLocales.sv };
      const getTextInput = (): HTMLInputElement =>
        fixture.nativeElement.querySelector('input');

      it('shows the stored time in 24h', async () => {
        await setup('9:00', iso);
        expect(getTextInput().type).not.toBe('time');
        expect(getTextInput().value).toBe('09:00');
      });

      it('writes a typed time back as canonical HH:mm', async () => {
        await setup('09:00', iso);
        const input = getTextInput();
        input.value = '2215';
        input.dispatchEvent(new Event('input'));
        expect(formControl.value).toBe('22:15');
        expect(formControl.dirty).toBe(true);
      });

      it('shows a value patched from outside, e.g. a form reset', async () => {
        await setup('09:00', iso);
        formControl.setValue('21:45');
        fixture.detectChanges();
        await fixture.whenStable();
        expect(getTextInput().value).toBe('21:45');
      });

      it('keeps text being typed when a saved earlier value echoes back', async () => {
        await setup('09:00', iso);
        const input = getTextInput();
        input.focus();
        const type = (text: string): void => {
          input.value = text;
          input.dispatchEvent(new Event('input'));
          fixture.detectChanges();
        };
        type('18');
        type('183');
        // the settings store hands the saved 18:00 back after "183"
        formControl.setValue('18:00');
        fixture.detectChanges();
        await fixture.whenStable();
        expect(input.value).toBe('183');

        type('1830');
        expect(formControl.value).toBe('18:30');
      });

      it('keeps a cleared field empty when the saved value echoes back', async () => {
        await setup('09:00', iso);
        const input = getTextInput();
        input.focus();
        input.value = '';
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        // the empty entry is invalid and never saved, so the store re-sends 09:00
        formControl.setValue('09:00');
        fixture.detectChanges();
        await fixture.whenStable();
        expect(input.value).toBe('');
      });

      it('clears the model for an empty entry', async () => {
        await setup('09:00', iso);
        const input = getTextInput();
        input.value = '';
        input.dispatchEvent(new Event('input'));
        expect(formControl.value).toBe('');
      });
    });
  });
});
