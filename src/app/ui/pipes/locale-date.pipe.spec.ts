import { TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import localeEn from '@angular/common/locales/en';
import localeEnGB from '@angular/common/locales/en-GB';
import { LocaleDatePipe } from './locale-date.pipe';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { Log } from '../../core/log';

describe('LocaleDatePipe', () => {
  let pipe: LocaleDatePipe;

  beforeAll(() => {
    // DatePipe needs locale data registered for non-default locales. In the app
    // this happens in main.ts; unit tests must register what they exercise.
    registerLocaleData(localeDe, 'de-DE');
    // Match prod: main.ts registers en-GB data under the bare 'en' id, so the
    // DEFAULT_LOCALE ('en-gb') fallback resolves to en-GB. Without this, Karma
    // resolves it to Angular's baked-in en-US and the fallback specs would pin
    // the wrong behavior.
    registerLocaleData(localeEnGB, 'en');
  });

  afterAll(() => {
    // The locale registry is module-global across the Karma run. Restore 'en'
    // to the baked-in en-US data, which is observably identical to the
    // pristine unregistered state (Angular's parent-locale shortcut).
    registerLocaleData(localeEn, 'en');
  });

  beforeEach(() => {
    const spy = jasmine.createSpyObj('DateTimeFormatService', ['formatTime'], {
      currentLocale: () => 'en-US',
    });

    TestBed.configureTestingModule({
      providers: [LocaleDatePipe, { provide: DateTimeFormatService, useValue: spy }],
    });

    pipe = TestBed.inject(LocaleDatePipe);
  });

  it('should be a pure pipe (SPAP-26)', () => {
    const def = (LocaleDatePipe as unknown as { ɵpipe?: { pure?: boolean } }).ɵpipe;
    expect(def).toBeTruthy();
    expect(def?.pure).toBe(true);
  });

  it('should return null for null input', () => {
    expect(pipe.transform(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(pipe.transform(undefined)).toBeNull();
  });

  it('should return null for NaN input', () => {
    expect(pipe.transform(NaN)).toBeNull();
  });

  it('should return null for Infinity input', () => {
    expect(pipe.transform(Infinity)).toBeNull();
  });

  it('should format valid number input', () => {
    const timestamp = new Date(2024, 0, 15, 14, 30).getTime();
    const result = pipe.transform(timestamp, 'short');
    expect(result).toBeTruthy();
  });

  it('should format valid Date input', () => {
    const date = new Date(2024, 0, 15, 14, 30);
    const result = pipe.transform(date, 'short');
    expect(result).toBeTruthy();
  });

  it('should return null for non-parseable string input instead of throwing', () => {
    expect(pipe.transform('invalid-date-string' as unknown as string)).toBeNull();
  });

  it('should return null for empty string input instead of throwing', () => {
    expect(pipe.transform('' as unknown as string)).toBeNull();
  });

  it('should be deterministic: same (value, format, locale) yields equal output', () => {
    const date = new Date(2024, 0, 15, 14, 30);
    const a = pipe.transform(date, 'MMMM', undefined, 'en-US');
    const b = pipe.transform(date, 'MMMM', undefined, 'en-US');
    expect(a).toBe(b);
    expect(a).toBe('January');
  });

  it('should fall back to the default locale instead of rendering blank when locale data is unregistered (NG0701)', () => {
    const date = new Date(2024, 0, 15, 14, 30);
    // 'th-TH' is a valid BCP-47 tag, but neither 'th-TH' nor 'th' locale data
    // is registered — pre-fallback this returned null (blank UI). 'shortDate'
    // is format-sensitive: en-GB (prod fallback) renders 15/01/2024, en-US
    // would render 1/15/24, so this pins the actual fallback locale.
    const result = pipe.transform(date, 'shortDate', undefined, 'th-TH');
    expect(result).toBe('15/01/2024');
  });

  it('should not warn for an unformattable value nor let it poison the per-locale warn dedup', () => {
    // Uses a locale no other spec touches: the warn dedup set is module-scoped.
    const warnSpy = spyOn(Log, 'warn');
    // Bad value: both locales fail => silent null, no locale blamed.
    expect(pipe.transform('invalid-date-string', 'short', undefined, 'el-GR')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    // The genuine NG0701 for the same locale must still be reported.
    const result = pipe.transform(new Date(2024, 0, 15), 'MMMM', undefined, 'el-GR');
    expect(result).toBe('January');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('should warn once per locale across pipe instances, not once per instance', () => {
    // Angular creates one pure-pipe instance per binding per embedded view
    // (e.g. `| localeDate` inside @for), so per-instance dedup would flood
    // the size-capped exportable log history with one warning per row.
    const warnSpy = spyOn(Log, 'warn');
    const date = new Date(2024, 0, 15, 14, 30);
    const secondPipe = TestBed.runInInjectionContext(() => new LocaleDatePipe());
    expect(pipe.transform(date, 'MMMM', undefined, 'da-DK')).toBe('January');
    expect(secondPipe.transform(date, 'MMMM', undefined, 'da-DK')).toBe('January');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('should react to a changed explicit locale arg (en-US vs de-DE)', () => {
    const date = new Date(2024, 0, 15, 14, 30);
    const en = pipe.transform(date, 'MMMM', undefined, 'en-US');
    const de = pipe.transform(date, 'MMMM', undefined, 'de-DE');
    expect(en).toBe('January');
    expect(de).toBe('Januar');
    expect(en).not.toBe(de);
  });
});
