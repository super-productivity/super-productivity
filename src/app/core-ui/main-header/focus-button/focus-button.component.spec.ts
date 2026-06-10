import { TestBed } from '@angular/core/testing';
import {
  EnvironmentInjector,
  runInInjectionContext,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { of } from 'rxjs';

import { FocusButtonComponent } from './focus-button.component';
import { FocusModeService } from '../../../features/focus-mode/focus-mode.service';
import { MetricService } from '../../../features/metric/metric.service';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { DateService } from '../../../core/date/date.service';
import { MatDialog } from '@angular/material/dialog';
import { FocusModeMode } from '../../../features/focus-mode/focus-mode.model';

interface MockFocusModeService {
  isSessionRunning: WritableSignal<boolean>;
  isSessionPaused: WritableSignal<boolean>;
  isBreakActive: WritableSignal<boolean>;
  progress: WritableSignal<number | null>;
  mode: WritableSignal<FocusModeMode>;
  currentCycle: WritableSignal<number>;
  timeRemaining: Signal<number | null>;
  timeElapsed: Signal<number | null>;
  openOverlay: jasmine.Spy;
}

describe('FocusButtonComponent', () => {
  let component: FocusButtonComponent;
  let mockFocusMode: MockFocusModeService;

  beforeEach(() => {
    mockFocusMode = {
      isSessionRunning: signal(false),
      isSessionPaused: signal(false),
      isBreakActive: signal(false),
      progress: signal<number | null>(null),
      mode: signal(FocusModeMode.Pomodoro),
      currentCycle: signal(1),
      timeRemaining: signal<number | null>(0),
      timeElapsed: signal<number | null>(0),
      openOverlay: jasmine.createSpy('openOverlay'),
    };

    const mockMetric = jasmine.createSpyObj('MetricService', [
      'getFocusSummaryForDay',
      'getMetricForDay$',
    ]);
    mockMetric.getFocusSummaryForDay.and.returnValue(null);
    mockMetric.getMetricForDay$.and.returnValue(of({ focusSessions: [] }));

    const mockGlobalConfig = jasmine.createSpyObj('GlobalConfigService', [], {
      cfg: signal({ keyboard: {} }),
    });

    const mockDate = jasmine.createSpyObj('DateService', ['todayStr']);
    mockDate.todayStr.and.returnValue('2026-05-06');

    const mockDialog = jasmine.createSpyObj('MatDialog', ['open']);

    TestBed.configureTestingModule({
      providers: [
        { provide: FocusModeService, useValue: mockFocusMode },
        { provide: MetricService, useValue: mockMetric },
        { provide: GlobalConfigService, useValue: mockGlobalConfig },
        { provide: DateService, useValue: mockDate },
        { provide: MatDialog, useValue: mockDialog },
      ],
    });

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
      component = new FocusButtonComponent();
    });
  });

  describe('cycleLabel', () => {
    it('returns null for non-Pomodoro modes', () => {
      mockFocusMode.mode.set(FocusModeMode.Flowtime);
      mockFocusMode.currentCycle.set(3);
      expect(component.cycleLabel()).toBeNull();

      mockFocusMode.mode.set(FocusModeMode.Countdown);
      expect(component.cycleLabel()).toBeNull();
    });

    it('shows the current cycle during a work session in Pomodoro', () => {
      mockFocusMode.mode.set(FocusModeMode.Pomodoro);
      mockFocusMode.isBreakActive.set(false);
      mockFocusMode.currentCycle.set(2);

      expect(component.cycleLabel()).toBe(2);
    });

    it('shows cycle - 1 during a break (the cycle that just finished)', () => {
      // Pomodoro reducer increments currentCycle on session-complete, so
      // during the subsequent break the "just finished" cycle is N-1.
      mockFocusMode.mode.set(FocusModeMode.Pomodoro);
      mockFocusMode.isBreakActive.set(true);
      mockFocusMode.currentCycle.set(3);

      expect(component.cycleLabel()).toBe(2);
    });

    it('floors at 1 during the very first break (cycle=1 edge case)', () => {
      // Defensive: if a break ever reports cycle=1, label should be "#1" not "#0".
      mockFocusMode.mode.set(FocusModeMode.Pomodoro);
      mockFocusMode.isBreakActive.set(true);
      mockFocusMode.currentCycle.set(1);

      expect(component.cycleLabel()).toBe(1);
    });

    it('treats cycle=0 as 1 to avoid showing "#0"', () => {
      mockFocusMode.mode.set(FocusModeMode.Pomodoro);
      mockFocusMode.isBreakActive.set(false);
      mockFocusMode.currentCycle.set(0);

      expect(component.cycleLabel()).toBe(1);
    });
  });

  describe('circleVisible', () => {
    it('is false when nothing is running', () => {
      expect(component.circleVisible()).toBe(false);
    });

    it('is true while a work session is running', () => {
      mockFocusMode.isSessionRunning.set(true);
      expect(component.circleVisible()).toBe(true);
    });

    it('stays true while a session is paused (regression guard)', () => {
      // Without isSessionPaused() in the gate, pausing would hide the
      // countdown — exactly what the focus-mode rework was meant to avoid.
      mockFocusMode.isSessionRunning.set(false);
      mockFocusMode.isSessionPaused.set(true);
      expect(component.circleVisible()).toBe(true);
    });

    it('is true during a break (running or paused)', () => {
      mockFocusMode.isBreakActive.set(true);
      expect(component.circleVisible()).toBe(true);
    });
  });
});
