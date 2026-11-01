import { LS } from '../../core/persistence/storage-keys.const';
import { Log } from '../../core/log';

/**
 * Device-local record of the native alarms a reminder effect armed. Native
 * alarms outlive the app process, but the effects' tracking was in-memory, so
 * a task completed or deleted (e.g. by sync) while the app was closed kept its
 * alarm and rang anyway. Seeding the tracking from here lets the next run
 * cancel it. Not synced: alarms are per device.
 */
const readArray = (key: LS): unknown[] => {
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    // Unreadable record: start empty, i.e. the pre-persistence behavior.
    Log.warn('armed-reminder-store: dropping unreadable record', {
      storageKey: String(key),
      error: String(e),
    });
    return [];
  }
};

/** Task ids whose alarms an earlier run armed. */
export const loadArmedIds = (key: LS): Set<string> =>
  new Set(readArray(key).filter((id): id is string => typeof id === 'string'));

/** Ids armed by an earlier run, with the time each alarm fires. */
export const loadArmedTriggers = (key: LS): Map<string, number> =>
  new Map(
    readArray(key).filter(
      (entry): entry is [string, number] =>
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'number',
    ),
  );

export const saveArmed = (key: LS, armed: Set<string> | Map<string, number>): void => {
  try {
    localStorage.setItem(key, JSON.stringify([...armed]));
  } catch (e) {
    // Called from effect `finally` blocks; a throw there is an unhandled
    // rejection. Unsaved, the next run just falls back to empty tracking.
    Log.err('armed-reminder-store: could not save record', {
      storageKey: String(key),
      error: String(e),
    });
  }
};
