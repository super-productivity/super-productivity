import { TestBed } from '@angular/core/testing';
import { FocusModeLocalSettingsService } from './focus-mode-local-settings.service';

const STORAGE_KEY = 'sp_focus_mode_local_settings';

describe('FocusModeLocalSettingsService', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('returns default settings when localStorage is empty', () => {
    const service = TestBed.inject(FocusModeLocalSettingsService);

    expect(service.settings()).toEqual({
      isLoopBreakEndAlarm: false,
    });
  });

  it('loads existing settings from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ isLoopBreakEndAlarm: true }));

    const service = TestBed.inject(FocusModeLocalSettingsService);

    expect(service.settings()).toEqual({
      isLoopBreakEndAlarm: true,
    });
  });

  it('merges partial updates and persists them', () => {
    const service = TestBed.inject(FocusModeLocalSettingsService);

    service.update({ isLoopBreakEndAlarm: true });

    expect(service.settings()).toEqual({
      isLoopBreakEndAlarm: true,
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      isLoopBreakEndAlarm: true,
    });
  });

  it('falls back to defaults if stored JSON is corrupt', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json');

    const service = TestBed.inject(FocusModeLocalSettingsService);

    expect(service.settings()).toEqual({
      isLoopBreakEndAlarm: false,
    });
  });
});
