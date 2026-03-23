import { Injectable, inject, Injector } from '@angular/core';
import { NativeDateAdapter } from '@angular/material/core';
import { DateTimeFormatService } from './date-time-format.service';
import { DEFAULT_FIRST_DAY_OF_WEEK } from 'src/app/core/locale.constants';
import { GlobalConfigService } from '../../features/config/global-config.service';

/** Custom DateAdapter that handles locale-aware date parsing and formatting */
@Injectable({ providedIn: 'root' })
export class CustomDateAdapter extends NativeDateAdapter {
  private readonly _globalConfigService = inject(GlobalConfigService);

  // Use a getter to avoid circular dependency issues with DateTimeFormatService
  private readonly _injector = inject(Injector);
  private get _dateTimeFormatService(): DateTimeFormatService {
    return this._injector.get(DateTimeFormatService);
  }

  override getFirstDayOfWeek(): number {
    const cfgValue = this._globalConfigService.localization()?.firstDayOfWeek;

    // If not set or reset - use Monday as default (ISO 8601 standard)
    // Note: Must use explicit null/undefined check since 0 (Sunday) is a valid value
    if (cfgValue === null || cfgValue === undefined) return DEFAULT_FIRST_DAY_OF_WEEK;

    // Default should be monday, if we have an invalid value for some reason
    return cfgValue >= 0 ? cfgValue : DEFAULT_FIRST_DAY_OF_WEEK;
  }

  override parse(value: any, format: string): Date | null {
    if (!value) return null;
    if (value instanceof Date) return this.isValid(value) ? value : null;
    if (typeof value !== 'string') return super.parse(value, format);

    // Parse using locale-aware format
    const parsed = this._dateTimeFormatService.parseStringToDate(
      value,
      this._dateTimeFormatService.dateFormat().raw,
    );

    return parsed !== null ? parsed : super.parse(value, format);
  }

  override format(
    date: Date,
    displayFormat: Intl.DateTimeFormatOptions | string,
  ): string {
    if (!this.isValid(date)) throw Error('DateAdapter: Cannot format invalid date.');

    // locale-specific format
    const localeSpecificFormat = this._dateTimeFormatService.dateFormat().raw;
    if (displayFormat === localeSpecificFormat) {
      return this._dateTimeFormatService.formatDate(date);
    }

    // For other formats, use default
    return super.format(date, displayFormat);
  }
}
