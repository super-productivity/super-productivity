import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { BrowserTitleService } from './browser-title.service';
import { FocusModeService } from '../../features/focus-mode/focus-mode.service';
import { signal } from '@angular/core';
import { FocusModeMode } from '../../features/focus-mode/focus-mode.model';

describe('BrowserTitleService', () => {
  let service: BrowserTitleService;
  let titleService: jasmine.SpyObj<Title>;
  let focusModeServiceMock: any;

  beforeEach(() => {
    titleService = jasmine.createSpyObj('Title', ['setTitle']);
    focusModeServiceMock = {
      mode: signal(FocusModeMode.Pomodoro),
      timeRemaining: signal(1500000),
      isBreakActive: signal(false),
      isRunning: signal(false),
      isSessionPaused: signal(false),
    };

    TestBed.configureTestingModule({
      providers: [
        BrowserTitleService,
        { provide: Title, useValue: titleService },
        { provide: FocusModeService, useValue: focusModeServiceMock },
      ],
    });

    service = TestBed.inject(BrowserTitleService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('_getTitle', () => {
    it('should return base title when not in Pomodoro mode', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Flowtime,
        1500000,
        false,
        true,
        false,
      );
      expect(result).toBe('Super Productivity');
    });

    it('should return base title when in Pomodoro but not running or paused', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Pomodoro,
        1500000,
        false,
        false,
        false,
      );
      expect(result).toBe('Super Productivity');
    });

    it('should show time when running', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Pomodoro,
        1500000, // 25:00
        false,
        true,
        false,
      );
      expect(result).toBe('(25:00) Super Productivity');
    });

    it('should show "Paused" when paused', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Pomodoro,
        1500000, // 25:00
        false,
        false,
        true,
      );
      expect(result).toBe('(Paused 25:00) Super Productivity');
    });

    it('should show "Break" when break is active', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Pomodoro,
        300000, // 05:00
        true,
        true,
        false,
      );
      expect(result).toBe('(05:00 Break) Super Productivity');
    });

    it('should show both "Paused" and "Break" when both are active', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Pomodoro,
        300000, // 05:00
        true,
        false,
        true,
      );
      expect(result).toBe('(Paused 05:00 Break) Super Productivity');
    });
  });

  it('should update document title when signals change', () => {
    focusModeServiceMock.isRunning.set(true);
    focusModeServiceMock.timeRemaining.set(1499000); // 24:59

    TestBed.flushEffects();
    expect(titleService.setTitle).toHaveBeenCalledWith('(24:59) Super Productivity');

    focusModeServiceMock.isBreakActive.set(true);
    focusModeServiceMock.timeRemaining.set(299000); // 04:59
    TestBed.flushEffects();
    expect(titleService.setTitle).toHaveBeenCalledWith(
      '(04:59 Break) Super Productivity',
    );

    focusModeServiceMock.isRunning.set(false);
    focusModeServiceMock.isSessionPaused.set(true);
    TestBed.flushEffects();
    expect(titleService.setTitle).toHaveBeenCalledWith(
      '(Paused 04:59 Break) Super Productivity',
    );

    focusModeServiceMock.mode.set(FocusModeMode.Flowtime);
    TestBed.flushEffects();
    expect(titleService.setTitle).toHaveBeenCalledWith('Super Productivity');
  });
});
