import { inject, LOCALE_ID, Pipe, PipeTransform } from '@angular/core';

const S = 1000;
const M = S * 60;
const H = M * 60;

const LOCALE_LABELS: Record<string, { h: string; m: string; s: string }> = {
  ru: { h: 'ч', m: 'мин', s: 'с' },
};

const getLabels = (locale?: string): { h: string; m: string; s: string } =>
  LOCALE_LABELS[locale || ''] || { h: 'h', m: 'm', s: 's' };

export const msToString = (
  value: number | null | undefined,
  isShowSeconds?: boolean,
  isHideEmptyPlaceholder?: boolean,
  locale?: string,
): string => {
  const numValue = Number(value) || 0;
  const hours = Math.floor(numValue / H);
  const hoursMs = hours * H;
  const minutes = Math.floor((numValue - hoursMs) / M);
  const minutesMs = minutes * M;
  const seconds = isShowSeconds ? Math.floor((numValue - hoursMs - minutesMs) / S) : 0;

  const { h, m, s } = getLabels(locale);

  const parsed =
    (hours > 0 ? hours + h + ' ' : '') +
    (minutes > 0 ? minutes + m + ' ' : '') +
    (isShowSeconds && seconds > 0 ? seconds + s + ' ' : '');

  if (!isHideEmptyPlaceholder && parsed.trim() === '') {
    return '-';
  }

  return parsed.trim();
};

@Pipe({ name: 'msToString' })
export class MsToStringPipe implements PipeTransform {
  private _locale: string = inject(LOCALE_ID);

  transform(
    value: number | null | undefined,
    isShowSeconds?: boolean,
    isHideEmptyPlaceholder?: boolean,
  ): string {
    return msToString(value, isShowSeconds, isHideEmptyPlaceholder, this._locale);
  }
}
