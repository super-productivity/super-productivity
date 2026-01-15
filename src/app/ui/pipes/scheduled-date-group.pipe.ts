import { inject, Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { T } from 'src/app/t.const';
import { getDbDateStr } from '../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pipe that formats scheduled date group keys with day of week.
 * Input: YYYY-MM-DD date string or special strings like "No date"
 * Output: "Wed 1/15" (en-US), "יום ד׳ 15.1" (he-IL), or "Today"
 * or pass through for non-date strings
 */
@Pipe({
  name: 'scheduledDateGroup',
  standalone: true,
  pure: false,
})
export class ScheduledDateGroupPipe implements PipeTransform {
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _translateService = inject(TranslateService);

  private _cache = new Map<string, string>();
  private _lastLocale?: string;

  transform(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    // Ensure value is a string
    if (typeof value !== 'string') {
      return String(value);
    }

    // Check if it's a date string (YYYY-MM-DD format)
    if (!DATE_REGEX.test(value)) {
      // Pass through non-date strings like "No date", "No tag", etc.
      return value;
    }

    const locale = this._dateTimeFormatService.currentLocale;

    // Clear cache if the language changes
    if (this._lastLocale !== locale) {
      this._cache.clear();
      this._lastLocale = locale;
    }

    // Check if we've already formatted this specific date for this locale
    if (this._cache.has(value)) {
      return this._cache.get(value)!;
    }

    const todayStr = getDbDateStr();
    if (value === todayStr) {
      return this._translateService.instant(T.G.TODAY_TAG_TITLE);
    }

    try {
      const date = dateStrToUtcDate(value);

      // Use Intl API to get locale-aware parts
      const formatter = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'numeric',
        day: 'numeric',
      });

      const parts = formatter.formatToParts(date);

      /**
       * Reconstruct the string while removing the comma
       * (Latin or Arabic) if one follows the weekday
       */
      const result = parts
        .map((part, index) => {
          // Check if the previous part was the weekday
          const isFollowsWeekday = index > 0 && parts[index - 1].type === 'weekday';

          // Check if current part is a literal containing a Latin (,) or Arabic (،) comma
          const isCommaLiteral = part.type === 'literal' && /[,،]/.test(part.value);

          if (isFollowsWeekday && isCommaLiteral) {
            // Remove commas but keep spaces and invisible RTL markers (\u200f etc.)
            return part.value.replace(/[,،]/g, '');
          }

          return part.value;
        })
        // Merge all parts back into a single string
        .join('')
        // Collapse any double spaces left by comma removal
        .replace(/\s{2,}/g, ' ')
        // Clean up any leading/trailing whitespace
        .trim();

      this._cache.set(value, result);
      return result;
    } catch (e) {
      // If date parsing or formatting fails, return raw string to avoid crashing
      console.error('ScheduledDateGroupPipe Error:', e);
      return value;
    }
  }
}
