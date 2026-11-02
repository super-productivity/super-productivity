import { LS } from '../../core/persistence/storage-keys.const';

export const DUE_DATE_NOTIFICATION_MAX_OFFSET_MS = 10 * 60 * 1000;

/**
 * Stable per-install delay for Android due-date notifications.
 *
 * Each Android alarm runs a stale check against SuperSync before it shows, and
 * due-date notifications default to 09:00:00 — so every device hit the server
 * at the same moment and exhausted its connection pool (measured 2026-09:
 * ~560 failed transactions in the 09:00 CEST hour; limit=100 pages, which only
 * Android background checks request, jumped from 7-13 to 65-77 in its first
 * minute). A random offset spreads that over ten minutes. It is stored so one
 * install keeps one time: re-rolling on every schedule would reshuffle alarms
 * and scatter a device's notifications.
 */
export const getDueDateNotificationOffsetMs = (): number => {
  const stored = localStorage.getItem(LS.DUE_DATE_NOTIFICATION_OFFSET_MS);
  const parsed = Number(stored);
  if (
    stored !== null &&
    Number.isInteger(parsed) &&
    parsed >= 0 &&
    parsed <= DUE_DATE_NOTIFICATION_MAX_OFFSET_MS
  ) {
    return parsed;
  }
  const offset = Math.floor(Math.random() * (DUE_DATE_NOTIFICATION_MAX_OFFSET_MS + 1));
  localStorage.setItem(LS.DUE_DATE_NOTIFICATION_OFFSET_MS, String(offset));
  return offset;
};
