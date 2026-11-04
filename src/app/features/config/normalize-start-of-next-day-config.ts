import { DEFAULT_GLOBAL_CONFIG } from './default-global-config.const';
import { GlobalConfigState, MiscConfig } from './global-config.model';
import {
  getStartOfNextDayHourFromTimeString,
  getValidStartOfNextDayHour,
} from '../../util/start-of-next-day.util';

type NormalizedMiscConfig = Omit<
  Partial<MiscConfig>,
  'startOfNextDay' | 'startOfNextDayTime'
> & {
  startOfNextDay?: number;
  startOfNextDayTime?: string;
};

const formatStartOfNextDayTime = (hour: number): string =>
  `${String(hour).padStart(2, '0')}:00`;

export const normalizeStartOfNextDayConfig = (
  misc: Partial<MiscConfig> = {},
): Partial<MiscConfig> => {
  // `startOfNextDayTime` wins when valid. When both fields arrive together
  // from sync/REST/plugin payloads we keep minute precision from
  // `startOfNextDayTime` and derive a legacy hour-only `startOfNextDay`.
  // If the time string is invalid, reset both fields to the default boundary.
  const normalized: NormalizedMiscConfig = { ...misc };

  if (misc.startOfNextDayTime != null) {
    const hour =
      typeof misc.startOfNextDayTime === 'string'
        ? getStartOfNextDayHourFromTimeString(misc.startOfNextDayTime)
        : undefined;
    if (hour != null) {
      normalized.startOfNextDay = hour;
    } else {
      // #7645: mirrors getStartOfNextDayDiffMs -- an invalid time string makes the
      // whole pair untrustworthy, because v18.5.0-v18.6.x derived the legacy hour
      // from that same string ('24:00' -> 23) and synced both. Repair to the default
      // (see that util for why we do not try to tell derived values from intent).
      const defaultHour = DEFAULT_GLOBAL_CONFIG.misc.startOfNextDay;
      normalized.startOfNextDay = defaultHour;
      normalized.startOfNextDayTime = formatStartOfNextDayTime(defaultHour);
    }
  }

  if (typeof misc.startOfNextDay === 'number' && normalized.startOfNextDayTime == null) {
    const hour =
      getValidStartOfNextDayHour(misc.startOfNextDay) ??
      DEFAULT_GLOBAL_CONFIG.misc.startOfNextDay;
    normalized.startOfNextDay = hour;
    normalized.startOfNextDayTime = formatStartOfNextDayTime(hour);
  }

  return normalized;
};

export const normalizeGlobalConfigStartOfNextDay = (
  globalConfig: GlobalConfigState | undefined,
): GlobalConfigState | undefined =>
  globalConfig
    ? {
        ...globalConfig,
        misc: {
          ...globalConfig.misc,
          ...normalizeStartOfNextDayConfig(globalConfig.misc),
        },
      }
    : globalConfig;
