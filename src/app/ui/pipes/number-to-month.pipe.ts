import { Pipe, PipeTransform } from '@angular/core';

/**
 * Turns a 1-based month number into its full, localized name.
 * Pass the text locale (`DateTimeFormatService.textLocale()`) so month names
 * match the UI language instead of always showing English.
 */
@Pipe({ name: 'numberToMonth' })
export class NumberToMonthPipe implements PipeTransform {
  transform(value: number | string, locale?: string): string | undefined {
    const month = parseInt(String(value), 10);
    if (!(month >= 1 && month <= 12)) {
      return undefined;
    }
    return new Date(Date.UTC(2000, month - 1, 1)).toLocaleDateString(locale, {
      month: 'long',
      timeZone: 'UTC',
    });
  }
}
