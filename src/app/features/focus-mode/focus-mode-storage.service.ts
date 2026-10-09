import { Injectable } from '@angular/core';
import { LS } from '../../core/persistence/storage-keys.const';
import { FocusModeMode, TimerState } from './focus-mode.model';

/**
 * A running or paused focus session, kept so it survives the WebView being
 * killed in the background (iOS, Android process death, page reload).
 */
export interface FocusSessionSnapshot {
  timer: TimerState;
  mode: FocusModeMode;
  currentCycle: number;
  pausedTaskId: string | null;
  trackedTaskId: string | null;
  savedAt: number;
}

const isSnapshot = (value: unknown): value is FocusSessionSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<FocusSessionSnapshot>;
  const t = s.timer as Partial<TimerState> | undefined;
  return (
    !!t &&
    (t.purpose === 'work' || t.purpose === 'break') &&
    typeof t.isRunning === 'boolean' &&
    typeof t.elapsed === 'number' &&
    typeof t.duration === 'number' &&
    (t.startedAt === null || typeof t.startedAt === 'number') &&
    Object.values(FocusModeMode).includes(s.mode as FocusModeMode) &&
    typeof s.currentCycle === 'number' &&
    typeof s.savedAt === 'number'
  );
};

@Injectable({ providedIn: 'root' })
export class FocusModeStorageService {
  getLastCountdownDuration(): number | null {
    const raw = localStorage.getItem(LS.LAST_COUNTDOWN_DURATION);
    if (!raw) {
      return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  setLastCountdownDuration(duration: number): void {
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }
    localStorage.setItem(LS.LAST_COUNTDOWN_DURATION, duration.toString());
  }

  getSessionSnapshot(): FocusSessionSnapshot | null {
    const raw = localStorage.getItem(LS.FOCUS_MODE_SESSION);
    if (!raw) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return isSnapshot(parsed) ? parsed : null;
    } catch {
      // A corrupt snapshot only means there is nothing to recover.
      return null;
    }
  }

  setSessionSnapshot(snapshot: FocusSessionSnapshot): void {
    localStorage.setItem(LS.FOCUS_MODE_SESSION, JSON.stringify(snapshot));
  }

  clearSessionSnapshot(): void {
    localStorage.removeItem(LS.FOCUS_MODE_SESSION);
  }
}
