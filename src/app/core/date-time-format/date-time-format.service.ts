import { computed, effect, inject, Injectable } from '@angular/core';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { DateAdapter } from '@angular/material/core';
import {
  DEFAULT_FIRST_DAY_OF_WEEK,
  DEFAULT_LOCALE,
  DateTimeLocale,
} from 'src/app/core/locale.constants';

@Injectable({
  providedIn: 'root',
})
export class DateTimeFormatService {
  private readonly _globalConfigService = inject(GlobalConfigService);
  private _dateAdapter = inject(DateAdapter);

  // Signal for the locale to use
  private readonly _locale = computed(() => {
    return this._globalConfigService.localization()?.dateTimeLocale || DEFAULT_LOCALE;
  });

  private readonly _testFormats = computed(() => {
    const locale = this._locale();
    const testDate = new Date(2000, 11, 31, 13, 0, 0);
    return {
      time: testDate.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }),
      date: testDate.toLocaleDateString(locale),
    };
  });

  // For detecting if current locale uses 24-hour format (used in schedule component)
  readonly is24HourFormat = computed(() => {
    return this._testFormats().time.includes('13');
  });

  // Get the current locale being used
  get currentLocale(): DateTimeLocale {
    return this._locale();
  }

  constructor() {
    this._initMonkeyPatchFirstDayOfWeek();

    // Use effect to reactively update date adapter locale when config changes
    effect(() => {
      const cfgValue = this._globalConfigService.localization()?.dateTimeLocale;
      if (cfgValue) this.setDateAdapterLocale(cfgValue);
    });
  }

  initialFirstDayOfWeek = this._dateAdapter.getFirstDayOfWeek();

  private _initMonkeyPatchFirstDayOfWeek(): void {
    // Use effect to reactively update firstDayOfWeek when config changes
    effect(() => {
      const cfgValue = this._globalConfigService.localization()?.firstDayOfWeek;

      // If not set or reset - use Monday as default (ISO 8601 standard)
      // Note: Must use explicit null/undefined check since 0 (Sunday) is a valid value
      if (cfgValue === null || cfgValue === undefined) {
        this._dateAdapter.getFirstDayOfWeek = () => DEFAULT_FIRST_DAY_OF_WEEK;
        return;
      }

      // Default should be monday, if we have an invalid value for some reason
      const validFirstDayOfWeek = cfgValue >= 0 ? cfgValue : DEFAULT_FIRST_DAY_OF_WEEK;

      // Overwrites default method to make this configurable
      this._dateAdapter.getFirstDayOfWeek = () => validFirstDayOfWeek;
    });
  }

  setDateAdapterLocale(locale: DateTimeLocale): void {
    this._dateAdapter.setLocale(locale);
  }

  formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString(this.currentLocale, {
      hour: 'numeric',
      minute: 'numeric',
    });
  }
}
