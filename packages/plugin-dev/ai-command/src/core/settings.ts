// Per-device settings, stored with the API key in secret storage.

import { DEFAULT_MODEL, MODELS } from './claude';

export interface Settings {
  model: string;
  isApplyWithoutReview: boolean;
  isNoticeAccepted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  model: DEFAULT_MODEL,
  isApplyWithoutReview: false,
  isNoticeAccepted: false,
};

const parseJson = (raw: string | null): Partial<Settings> | null => {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? (value as Partial<Settings>) : null;
  } catch {
    // A corrupt value must not lock the panel; the next save overwrites it.
    return null;
  }
};

/** Reads stored settings; unknown or broken values fall back to the defaults. */
export const parseSettings = (raw: string | null): Settings => {
  const parsed = parseJson(raw);
  if (!parsed) return DEFAULT_SETTINGS;
  return {
    model: MODELS.some((m) => m.id === parsed.model)
      ? (parsed.model as string)
      : DEFAULT_MODEL,
    isApplyWithoutReview: parsed.isApplyWithoutReview === true,
    isNoticeAccepted: parsed.isNoticeAccepted === true,
  };
};
