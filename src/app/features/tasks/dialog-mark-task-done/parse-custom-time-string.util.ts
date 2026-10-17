import { durationToString } from '../../../ui/duration/duration-to-string.pipe';

/**
 * Flexible shorthand time string parser.
 * Supports:
 * - Standalone 'am' / 'pm' to flip period
 * - Explicit '9a', '9am', '11p', '11pm'
 * - Shorthand digits without colon: '9' -> 9:00, '11' -> 11:00, '930' -> 9:30, '1130' -> 11:30
 * - Standard colon format: '9:30', '14:30', '10:45 AM'
 * - Retains AM/PM period context of current24h when explicit period is not provided.
 */
export const parseCustomTimeString = (
  str: string | null | undefined,
  current24h?: string,
): string => {
  const fallback = current24h || '12:00';
  if (!str || typeof str !== 'string') {
    return fallback;
  }
  const raw = str.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  let currentH = 12;
  let currentM = 0;
  if (current24h && current24h.includes(':')) {
    const parts = current24h.split(':');
    currentH = parseInt(parts[0], 10) || 0;
    currentM = parseInt(parts[1], 10) || 0;
  }
  const currentIsPM = currentH >= 12;

  // Handle standalone 'am' or 'pm' toggle
  if (raw === 'am' || raw === 'pm') {
    if (raw === 'am' && currentH >= 12) {
      currentH -= 12;
    }
    if (raw === 'pm' && currentH < 12) {
      currentH += 12;
    }
    return `${String(currentH).padStart(2, '0')}:${String(currentM).padStart(2, '0')}`;
  }

  const isExplicitAM = raw.includes('a');
  const isExplicitPM = raw.includes('p');

  // Strip non-digit and non-colon characters
  const clean = raw.replace(/[^0-9:]/g, '');
  if (!clean) {
    return fallback;
  }

  let hours = 0;
  let minutes = 0;

  if (clean.includes(':')) {
    const [hStr, mStr] = clean.split(':');
    hours = parseInt(hStr, 10) || 0;
    minutes = parseInt(mStr, 10) || 0;
  } else {
    const num = parseInt(clean, 10);
    if (clean.length <= 2) {
      hours = num;
      minutes = 0;
    } else if (clean.length === 3) {
      hours = Math.floor(num / 100);
      minutes = num % 100;
    } else {
      hours = Math.floor(num / 100);
      minutes = num % 100;
    }
  }

  // Convert 12h to 24h
  if (isExplicitPM) {
    if (hours < 12) {
      hours += 12;
    } else if (hours === 24) {
      hours = 12;
    }
  } else if (isExplicitAM) {
    if (hours === 12) {
      hours = 0;
    }
  } else {
    // Retain AM/PM context of current time if user entered 1-12 without explicit am/pm
    if (hours >= 1 && hours <= 12) {
      if (currentIsPM && hours < 12) {
        hours += 12;
      } else if (!currentIsPM && hours === 12) {
        hours = 0;
      }
    }
  }

  hours = Math.max(0, Math.min(23, hours));
  minutes = Math.max(0, Math.min(59, minutes));

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

/**
 * Formats a 24h clock string (e.g. '09:30' or '22:45') into 12h representation ('9:30 AM', '10:45 PM').
 */
export const formatTime12h = (time24: string | null | undefined): string => {
  if (!time24) {
    return '12:00 AM';
  }
  const parts = time24.split(':');
  let h = parseInt(parts[0], 10);
  if (isNaN(h)) {
    h = 0;
  }
  const m = parts[1] ? parts[1].padStart(2, '0') : '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) {
    h = 12;
  }
  return `${h}:${m} ${ampm}`;
};

/**
 * Formats duration in milliseconds to human readable format (e.g. '30m', '1h', '1h 30m').
 * Returns '0m' if non-positive or missing.
 */
export const formatDuration = (ms: number | null | undefined): string => {
  if (!ms || ms <= 0) {
    return '0m';
  }
  const str = durationToString(ms);
  return str || '0m';
};
