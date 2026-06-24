import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { DateAdapter } from '@angular/material/core';
import { DEFAULT_LOCALE, DateTimeLocale } from 'src/app/core/locale.constants';
import { TranslateService } from '@ngx-translate/core';

@Injectable({
  providedIn: 'root',
})
export class DateTimeFormatService {
  private readonly _globalConfigService = inject(GlobalConfigService);
  private _dateAdapter = inject(DateAdapter, { optional: true });
  private readonly _translateService = inject(TranslateService);
  private readonly _localeSig = signal<DateTimeLocale>(DEFAULT_LOCALE);
  // UI translation language, pushed in by LanguageService. Used only as the
  // lowest-priority fallback when no explicit dateTimeLocale override is set.
  // Kept as a signal so the locale effect re-runs when the language changes.
  private readonly _uiLangSig = signal<string | null>(null);

  // Signal for the locale to use
  readonly currentLocale = computed<DateTimeLocale>(() => {
    return this._globalConfigService.localization()?.dateTimeLocale || this._localeSig();
  });

  /** Test formats to detect locale-specific time and date formats (e.g., 24h vs 12h, DD/MM vs MM/DD) */
  private readonly _testFormats = computed(() => {
    const locale = this.currentLocale();
    const testDate = new Date(2000, 11, 31, 13, 0, 0);

    return {
      // "1:00 PM" (en-US) | "13:00" (en-GB)
      time: testDate.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }),
      date: {
        // "12/31/2000" (en-US) | "31/12/2000" (en-GB)
        raw: testDate.toLocaleDateString(locale),
        // "MM/dd/yyyy" (en-US) | "dd/MM/yyyy" (en-GB)
        format: testDate
          .toLocaleDateString(locale)
          .replace('31', 'dd')
          .replace('12', 'MM')
          .replace('2000', 'yyyy'),
      },
    };
  });

  // For detecting if current locale uses 24-hour format (used in schedule component)
  readonly is24HourFormat = computed(() => {
    return this._testFormats().time.includes('13');
  });

  /** Detects the actual date format based on locale ('dd/MM/yyyy', 'MM/dd/yyyy', 'dd.MM.yyyy', etc) */
  readonly dateFormat = computed(() => {
    const localizedDate = this._testFormats().date;

    return {
      raw: localizedDate.format,
      humanReadable: localizedDate.format.toUpperCase(),
    };
  });

  constructor() {
    // This effect is the single owner of the date adapter locale: it resolves
    // the effective locale (explicit override first, UI language only as a
    // fallback) and is the sole writer. Other services must register intent via
    // setUiLanguage() rather than set the adapter, otherwise an explicit
    // dateTimeLocale override gets clobbered (e.g. #8565: 24h ja-jp shown 12h).
    effect(() => {
      const cfgValue = this._globalConfigService.localization()?.dateTimeLocale;
      // Track the UI language so a language change re-applies the fallback.
      const uiLang = this._uiLangSig();
      if (cfgValue) {
        this._setDateAdapterLocale(cfgValue);
      } else {
        // No explicit date/time override: follow the browser's regional locale
        // (e.g. 'en-GB' → DD/MM/YYYY) rather than the UI translation language.
        // The UI language is region-agnostic — 'en' resolves to US MM/DD/YYYY,
        // which would mis-format dates for en-GB/en-AU/etc. users who never
        // picked a date locale. Fall back to UI language, then the default.
        const fallbackLocale =
          this._translateService.getBrowserCultureLang?.()?.toLowerCase() ||
          uiLang ||
          this._translateService.currentLang ||
          this._translateService.defaultLang ||
          DEFAULT_LOCALE;
        this._setDateAdapterLocale(fallbackLocale as DateTimeLocale);
      }
    });
  }

  /**
   * Register the active UI translation language as a fallback for the date
   * adapter locale (used only when no explicit dateTimeLocale is set). The
   * owning effect resolves and applies the effective locale — this is how other
   * services influence the adapter without clobbering an override (see #8565).
   */
  setUiLanguage(lng: string): void {
    this._uiLangSig.set(lng);
  }

  /**
   * Apply the locale to the date adapter. Private by design: only the owning
   * effect may write the adapter locale, so an explicit dateTimeLocale override
   * cannot be clobbered (see #8565).
   */
  private _setDateAdapterLocale(locale: DateTimeLocale): void {
    if (this._dateAdapter && typeof this._dateAdapter.setLocale === 'function') {
      this._dateAdapter.setLocale(locale);
    }
    this._localeSig.set(locale);
  }

  /**
   * Format a timestamp to time string based on locale format
   *
   * @example
   * // For en-US locale
   * formatTime(new Date(2000, 11, 31, 13, 0, 0).getTime()); // 1:00 PM
   *
   * // For en-GB locale
   * formatTime(new Date(2000, 11, 31, 13, 0, 0).getTime()); // 13:00
   */
  formatTime(timestamp: number, locale: DateTimeLocale = this.currentLocale()): string {
    return new Date(timestamp).toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: 'numeric',
    });
  }

  /**
   * Format a date to string based on locale format
   *
   * @example
   * // For en-US locale
   * formatDate(new Date(2000, 11, 31), 'en-US'); // 12/31/2000
   *
   * // For en-GB locale
   * formatDate(new Date(2000, 11, 31), 'en-GB'); // 31/12/2000
   */
  formatDate(date: Date, locale: DateTimeLocale = this.currentLocale()): string {
    const formatter = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    return formatter.format(date);
  }

  // Extract separator from format string
  extractSeparator(format: string): string {
    const foundSeparator = format.match(/[^\w]+/)?.[0];
    return foundSeparator || '/';
  }

  /**
   * Parse a string date based on locale format
   * Supported formats: `DD/MM/YYYY`, `MM/DD/YYYY`, `DD.MM.YYYY`, `DD. MM. YYYY`, etc
   * Time parsing is not supported - will be set to 00:00:00
   *
   * @example
   * // For en-US locale
   * parseStringToDate('12/31/2000', 'MM/dd/yyyy'); // Date object for Dec 31, 2000
   *
   * // For en-GB locale
   * parseStringToDate('31/12/2000', 'dd/MM/yyyy'); // Date object for Dec 31, 2000
   *
   * // For ru-RU locale
   * parseStringToDate('31.12.2000', 'dd.MM.yyyy'); // Date object for Dec 31, 2000
   *
   * // For ko-KR locale
   * parseStringToDate('2000. 12. 31.', 'yyyy. MM. dd.'); // Date object for Dec 31, 2000
   */
  parseStringToDate(dateString: string, format: string): Date | null {
    const separator = this.extractSeparator(format);
    const formatParts = format.split(separator);
    const dateParts = dateString
      .trim()
      .split(separator)
      .filter((part) => part.trim() !== '');

    // Basic validation to ensure we have the expected number of parts
    if (formatParts.length !== 3 || dateParts.length !== 3) return null;

    // Build a format mapping by matching positions
    const values: Record<string, number> = {};
    formatParts.forEach((formatPart, i) => {
      const key = formatPart
        .trim()
        .toLowerCase() // normalize to lowercase for easier matching
        .replace(/[^\w]+/g, '');
      const val = parseInt(dateParts[i].trim(), 10);
      if (isNaN(val)) return;
      values[key] = val;
    });

    const year = values['yyyy'];
    const month = values['mm'];
    const day = values['dd'];

    if (year === undefined || month === undefined || day === undefined) return null;
    if (year.toString().length !== 4 || day > 31 || day < 1 || month > 12 || month < 1) {
      return null;
    }

    const date = new Date(year, month - 1, day);

    // Validate the date by checking if constructed date matches input values
    const isValid =
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day;

    return isValid ? date : null;
  }
}
