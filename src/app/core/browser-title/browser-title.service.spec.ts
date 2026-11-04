import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { BrowserTitleService } from './browser-title.service';
import { FocusModeMode } from '../../features/focus-mode/focus-mode.model';
import { FocusModeService } from '../../features/focus-mode/focus-mode.service';
import { TaskService } from '../../features/tasks/task.service';
import { DateService } from '../date/date.service';
import { Task } from '../../features/tasks/task.model';

const TODAY_STR = '2026-07-26';

describe('BrowserTitleService', () => {
  let service: BrowserTitleService;
  let titleService: jasmine.SpyObj<Title>;
  let translateService: jasmine.SpyObj<TranslateService>;
  let focusModeServiceMock: any;
  let currentTask$: BehaviorSubject<Task | null>;

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

    currentTask$ = new BehaviorSubject<Task | null>(null);

    TestBed.configureTestingModule({
      providers: [
        BrowserTitleService,
        { provide: Title, useValue: titleService },
        { provide: TranslateService, useValue: translateService },
        { provide: FocusModeService, useValue: focusModeServiceMock },
        { provide: TaskService, useValue: { currentTask$ } },
        { provide: DateService, useValue: { todayStr: () => TODAY_STR } },
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

    it('should show "Paused" for Flowtime mode when paused and time has elapsed', () => {
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

    it('should show remaining time for Flowtime break offer (not running, zero elapsed)', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Flowtime,
        300000,
        true,
        false,
        true,
        false,
        0,
      );

      expect(result).toBe('05:00 (Break)');
    });

    it('should show remaining time for active Flowtime break', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Flowtime,
        270000,
        true,
        true,
        false,
        false,
        30000,
      );

      expect(result).toBe('04:30 (Break)');
    });

    it('should show "Paused" and remaining time for paused Flowtime break', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Flowtime,
        270000,
        true,
        false,
        true,
        false,
        30000,
      );

      expect(result).toBe('Paused 04:30 (Break)');
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

    it('should show both "Paused" and "Break" when both are active and time elapsed', () => {
      const result = (service as any)._getTitle(
        FocusModeMode.Pomodoro,
        300000,
        true,
        false,
        true,
        false,
        1000,
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

  describe('plain time tracking', () => {
    const taskWithTimeToday = (ms: number): Task =>
      ({
        id: 'T1',
        title: 'Some task',
        timeSpentOnDay: ms ? { [TODAY_STR]: ms } : {},
      }) as unknown as Task;

    it('should show base title when nothing is tracked', () => {
      TestBed.flushEffects();

      expect(titleService.setTitle).toHaveBeenCalledWith('Super Productivity');
    });

    it("should show today's time and the task title", () => {
      currentTask$.next(taskWithTimeToday(1500000));

      TestBed.flushEffects();

      expect(titleService.setTitle).toHaveBeenCalledWith('25m - Some task');
    });

    it('should show 0m rather than a dash placeholder for a fresh task', () => {
      currentTask$.next(taskWithTimeToday(0));

      TestBed.flushEffects();

      expect(titleService.setTitle).toHaveBeenCalledWith('0m - Some task');
    });

    it('should let a running focus session win over the tracking title', () => {
      currentTask$.next(taskWithTimeToday(1500000));
      focusModeServiceMock.isRunning.set(true);
      focusModeServiceMock.timeRemaining.set(600000);

      TestBed.flushEffects();

      expect(titleService.setTitle).toHaveBeenCalledWith('10:00');
    });

    it('should fall back to the tracking title once a focus session ends', () => {
      currentTask$.next(taskWithTimeToday(3600000));
      focusModeServiceMock.isRunning.set(true);

      TestBed.flushEffects();

      focusModeServiceMock.isRunning.set(false);

      TestBed.flushEffects();

      expect(titleService.setTitle).toHaveBeenCalledWith('1h - Some task');
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
      focusModeServiceMock.timeElapsed.set(1000);

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
