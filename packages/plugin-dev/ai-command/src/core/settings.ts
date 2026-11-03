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

/** Reads stored settings; unknown or broken values fall back to the defaults. */
export const parseSettings = (raw: string | null): Settings => {
  if (!raw) return DEFAULT_SETTINGS;
  const parsed = JSON.parse(raw) as Partial<Settings>;
  return {
    model: MODELS.some((m) => m.id === parsed.model)
      ? (parsed.model as string)
      : DEFAULT_MODEL,
    isApplyWithoutReview: parsed.isApplyWithoutReview === true,
    isNoticeAccepted: parsed.isNoticeAccepted === true,
  };
};
