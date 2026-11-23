import { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  seller: '',
  paymentNote: '',
  currency: 'EUR',
  taxRatePct: 0,
  paymentDays: 14,
  roundingMin: 0,
  numberPrefix: '',
  projects: {},
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Parses stored settings; missing or malformed fields fall back to defaults. */
export const parseSettings = (raw: string | null): Settings => {
  if (!raw) return { ...DEFAULT_SETTINGS };
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return { ...DEFAULT_SETTINGS };
  const merged = { ...DEFAULT_SETTINGS, ...parsed } as Settings;
  return { ...merged, projects: isRecord(merged.projects) ? merged.projects : {} };
};
