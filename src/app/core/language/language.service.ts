import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import {
  AUTO_SWITCH_LNGS,
  DEFAULT_LANGUAGE,
  LanguageCode,
  RTL_LANGUAGES,
} from '../../core/locale.constants';
import { Log } from '../log';
import { DateTimeFormatService } from '../date-time-format/date-time-format.service';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private _translateService = inject(TranslateService);
  private _dateTimeFormatService = inject(DateTimeFormatService);

  // I think a better approach is to add a field in every [lang].json file to specify the direction of the language
  private readonly _isRTL = signal<boolean>(false);
  readonly isLangRTL = this._isRTL.asReadonly();

  /** Detect user system lanuage */
  detect(): LanguageCode {
    // Use culture language (e.g. `pt-BR`) if supported
    const locale = this._translateService.getBrowserCultureLang()?.toLocaleLowerCase();
    if (this.isSupported(locale)) return locale;

    // Use language (e.g. `pt`) if supported
    const language = this._translateService.getBrowserLang()?.toLocaleLowerCase();
    if (this.isSupported(language)) return language;

    // Fallback - use default language
    return DEFAULT_LANGUAGE;
  }

  /** Check if language is supported by the app */
  isSupported(lang?: string): lang is LanguageCode {
    return Object.values(LanguageCode).includes(lang?.toLowerCase() as LanguageCode);
  }

  setLng(lng?: LanguageCode | null): void {
    if (!lng) this._set(this.detect());
    else if (this.isSupported(lng)) this._set(lng);
    else {
      Log.err('Not supported language code', lng);
      this.tryAutoswitch();
    }
  }

  tryAutoswitch(): boolean {
    const lang = this.detect();
    const needAutoswitch = AUTO_SWITCH_LNGS.includes(lang);
    if (!needAutoswitch) return false;

    // Switch to default language
    this._set(DEFAULT_LANGUAGE);
    return true;
  }

  private _set(lng: LanguageCode): void {
    this._isRTL.set(this._checkIsRTL(lng));
    this._translateService.use(lng);

    // Register the UI language as a *fallback* only; DateTimeFormatService owns
    // the adapter locale and keeps an explicit dateTimeLocale override winning.
    // Setting the adapter locale directly here would clobber that override (#8565).
    this._dateTimeFormatService.setUiLanguage(lng);
  }

  private _checkIsRTL(lng: LanguageCode): boolean {
    return RTL_LANGUAGES.indexOf(lng) !== -1;
  }
}
