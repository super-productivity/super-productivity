import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { TranslateService } from '@ngx-translate/core';
import { BrowserTitleService } from './browser-title.service';
import { FocusModeMode } from '../../features/focus-mode/focus-mode.model';
import { FocusModeService } from '../../features/focus-mode/focus-mode.service';

describe('BrowserTitleService', () => {
  let service: BrowserTitleService;
  let titleService: jasmine.SpyObj<Title>;
  let translateService: jasmine.SpyObj<TranslateService>;
  let focusModeServiceMock: any;

  beforeEach(() => {
    titleService = jasmine.createSpyObj('Title', ['setTitle']);

    translateService = jasmine.createSpyObj('TranslateService', ['instant']);

    translateService.instant.and.callFake((key: string) => {
      if (key.includes('BREAK')) {
        return 'Break';
      }

      if (key.includes('PAUSED')) {
        return 'Paused';
      }

      return key;
    });

    focusModeServiceMock = {
      mode: signal(FocusModeMode.Pomodoro),
      timeRemaining: signal(1500000),
      timeElapsed: signal(0),
      isBreakActive: signal(false),
      isRunning: signal(false),
      isSessionPaused: signal(false),
      isInOvertime: signal(false),
    };

    TestBed.configureTestingModule({
      providers: [
        BrowserTitleService,
        { provide: Title, useValue: titleService },
        { provide: TranslateService, useValue: translateService },
        { provide: FocusModeService, useValue: focusModeServiceMock },
      ],
    });

    service = TestBed.inject(BrowserTitleService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('_getTitle', () => {
    it('should show elapsed time for Flowtime mode when running', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Flowtime,
        1500000,
        false,
        true,
        false,
        false,
        30000,
      );

      expect(result).toBe('00:30');
    });

    it('should show "Paused" for Flowtime mode when paused', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Flowtime,
        0,
        false,
        false,
        true,
        false,
        120000,
      );

      expect(result).toBe('Paused 02:00');
    });

    it('should show remaining time for Countdown mode when running', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Countdown,
        600000,
        false,
        true,
        false,
        false,
        0,
      );

      expect(result).toBe('10:00');
    });

    it('should return base title when in Pomodoro but not running or paused', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Pomodoro,
        1500000,
        false,
        false,
        false,
        false,
        0,
      );

      expect(result).toBe('Super Productivity');
    });

    it('should show remaining time when running', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Pomodoro,
        1500000,
        false,
        true,
        false,
        false,
        0,
      );

      expect(result).toBe('25:00');
    });

    it('should show "Paused" when paused', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Pomodoro,
        1500000,
        false,
        false,
        true,
        false,
        0,
      );

      expect(result).toBe('Paused 25:00');
    });

    it('should show "Break" when break is active', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Pomodoro,
        300000,
        true,
        true,
        false,
        false,
        0,
      );

      expect(result).toBe('05:00 (Break)');
    });

    it('should show both "Paused" and "Break" when both are active', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Pomodoro,
        300000,
        true,
        false,
        true,
        false,
        0,
      );

      expect(result).toBe('Paused 05:00 (Break)');
    });

    it('should show elapsed time during overtime', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Pomodoro,
        0,
        false,
        true,
        false,
        true,
        1560000,
      );

      expect(result).toBe('26:00');
    });

    it('should show elapsed break time during overtime', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Pomodoro,
        0,
        true,
        true,
        false,
        true,
        360000,
      );

      expect(result).toBe('06:00 (Break)');
    });

    it('should pad single digit minutes correctly', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Pomodoro,
        300000,
        false,
        true,
        false,
        false,
        0,
      );

      expect(result).toBe('05:00');
    });
  });

  describe('effect integration', () => {
    it('should update document title when signals change', () => {
      focusModeServiceMock.isRunning.set(true);
      focusModeServiceMock.timeRemaining.set(1499000);

      TestBed.flushEffects();

      expect(titleService.setTitle).toHaveBeenCalledWith('24:59');

      focusModeServiceMock.isBreakActive.set(true);
      focusModeServiceMock.timeRemaining.set(299000);

      TestBed.flushEffects();

      expect(titleService.setTitle).toHaveBeenCalledWith('04:59 (Break)');

      focusModeServiceMock.isRunning.set(false);
      focusModeServiceMock.isSessionPaused.set(true);

      TestBed.flushEffects();

      expect(titleService.setTitle).toHaveBeenCalledWith('Paused 04:59 (Break)');

      focusModeServiceMock.isSessionPaused.set(false);
      focusModeServiceMock.isRunning.set(true);
      focusModeServiceMock.isInOvertime.set(true);
      focusModeServiceMock.timeElapsed.set(1560000);

      TestBed.flushEffects();

      expect(titleService.setTitle).toHaveBeenCalledWith('26:00 (Break)');

      focusModeServiceMock.mode.set(FocusModeMode.Flowtime);
      focusModeServiceMock.timeElapsed.set(60000);

      TestBed.flushEffects();

      expect(titleService.setTitle).toHaveBeenCalledWith('01:00 (Break)');

      focusModeServiceMock.isRunning.set(false);
      focusModeServiceMock.isSessionPaused.set(false);

      TestBed.flushEffects();

      expect(titleService.setTitle).toHaveBeenCalledWith('Super Productivity');
    });
  });
});
