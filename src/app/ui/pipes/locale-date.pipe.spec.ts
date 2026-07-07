import { TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import { LocaleDatePipe } from './locale-date.pipe';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';

describe('LocaleDatePipe', () => {
  let pipe: LocaleDatePipe;

  beforeAll(() => {
    // DatePipe needs locale data registered for non-default locales. In the app
    // this happens in main.ts; unit tests must register what they exercise.
    registerLocaleData(localeDe, 'de-DE');
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

  it('should react to a changed explicit locale arg (en-US vs de-DE)', () => {
    const date = new Date(2024, 0, 15, 14, 30);
    const en = pipe.transform(date, 'MMMM', undefined, 'en-US');
    const de = pipe.transform(date, 'MMMM', undefined, 'de-DE');
    expect(en).toBe('January');
    expect(de).toBe('Januar');
    expect(en).not.toBe(de);
  });
});
