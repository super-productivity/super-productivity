import { TestBed } from '@angular/core/testing';
import { FocusModeStorageService } from './focus-mode-storage.service';
import { LS } from '../../core/persistence/storage-keys.const';
import { FocusModeMode } from './focus-mode.model';

describe('FocusModeStorageService', () => {
  let service: FocusModeStorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FocusModeStorageService);
    localStorage.clear();
  });

  it('should return null when storage is empty', () => {
    expect(service.getLastCountdownDuration()).toBeNull();
  });

  it('should read stored duration value', () => {
    localStorage.setItem(LS.LAST_COUNTDOWN_DURATION, '42000');

    expect(service.getLastCountdownDuration()).toBe(42_000);
  });

  it('should ignore invalid values', () => {
    localStorage.setItem(LS.LAST_COUNTDOWN_DURATION, 'not-a-number');

    expect(service.getLastCountdownDuration()).toBeNull();
  });

  it('should persist positive durations', () => {
    service.setLastCountdownDuration(30_000);

    expect(localStorage.getItem(LS.LAST_COUNTDOWN_DURATION)).toBe('30000');
  });

  it('should ignore non-positive durations when persisting', () => {
    localStorage.setItem(LS.LAST_COUNTDOWN_DURATION, '30000');

    service.setLastCountdownDuration(0);

    expect(localStorage.getItem(LS.LAST_COUNTDOWN_DURATION)).toBe('30000');
  });
  describe('session snapshot', () => {
    const snapshot = {
      timer: {
        isRunning: true,
        startedAt: 1_000,
        elapsed: 0,
        duration: 25 * 60_000,
        purpose: 'work' as const,
      },
      mode: FocusModeMode.Pomodoro,
      currentCycle: 2,
      pausedTaskId: null,
      trackedTaskId: 'task-1',
      savedAt: 2_000,
    };

    it('round-trips a stored session', () => {
      service.setSessionSnapshot(snapshot);

      expect(service.getSessionSnapshot()).toEqual(snapshot);
    });

    it('returns null for corrupt or mis-shaped data', () => {
      localStorage.setItem(LS.FOCUS_MODE_SESSION, '{not json');
      expect(service.getSessionSnapshot()).toBeNull();

      localStorage.setItem(
        LS.FOCUS_MODE_SESSION,
        JSON.stringify({ ...snapshot, timer: { ...snapshot.timer, purpose: null } }),
      );
      expect(service.getSessionSnapshot()).toBeNull();
    });

    it('clears the stored session', () => {
      service.setSessionSnapshot(snapshot);

      service.clearSessionSnapshot();

      expect(service.getSessionSnapshot()).toBeNull();
    });
  });
});
