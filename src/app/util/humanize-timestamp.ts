import { TranslateService } from '@ngx-translate/core';
import { T } from '../t.const';

/**
 * Convert a timestamp to a human-readable relative time string
 * Similar to moment's fromNow() function
 */
export const humanizeTimestamp = (
  value: Date | number | string,
  translateService: TranslateService,
): string => {
  if (!value) {
    return '';
  }

  const date = typeof value === 'object' ? value : new Date(value);
  if (isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 0) {
    // Future dates
    const futureDiffSeconds = Math.abs(diffSeconds);
    const futureDiffMinutes = Math.abs(diffMinutes);
    const futureDiffHours = Math.abs(diffHours);
    const futureDiffDays = Math.abs(diffDays);
    const futureDiffMonths = Math.abs(diffMonths);
    const futureDiffYears = Math.abs(diffYears);

    if (futureDiffSeconds < 45) {
      return translateService.instant(T.GLOBAL_RELATIVE_TIME.FUTURE.FEW_SECONDS);
    } else if (futureDiffSeconds < 90) {
      return translateService.instant(T.GLOBAL_RELATIVE_TIME.FUTURE.A_MINUTE);
    } else if (futureDiffMinutes < 45) {
      return translateService.instant(T.GLOBAL_RELATIVE_TIME.FUTURE.MINUTES, {
        count: futureDiffMinutes,
      });
    } else if (futureDiffMinutes < 90) {
      return translateService.instant(T.GLOBAL_RELATIVE_TIME.FUTURE.AN_HOUR);
    } else if (futureDiffHours < 22) {
      return translateService.instant(T.GLOBAL_RELATIVE_TIME.FUTURE.HOURS, {
        count: futureDiffHours,
      });
    } else if (futureDiffHours < 36) {
      return translateService.instant(T.GLOBAL_RELATIVE_TIME.FUTURE.A_DAY);
    } else if (futureDiffDays < 25) {
      return translateService.instant(T.GLOBAL_RELATIVE_TIME.FUTURE.DAYS, {
        count: futureDiffDays,
      });
    } else if (futureDiffDays < 45) {
      return translateService.instant(T.GLOBAL_RELATIVE_TIME.FUTURE.A_MONTH);
    } else if (futureDiffMonths < 11) {
      return translateService.instant(T.GLOBAL_RELATIVE_TIME.FUTURE.MONTHS, {
        count: futureDiffMonths,
      });
    } else if (futureDiffYears === 1) {
      return translateService.instant(T.GLOBAL_RELATIVE_TIME.FUTURE.A_YEAR);
    } else {
      return translateService.instant(T.GLOBAL_RELATIVE_TIME.FUTURE.YEARS, {
        count: futureDiffYears,
      });
    }
  }

  // Past dates
  if (diffSeconds < 45) {
    return translateService.instant(T.GLOBAL_RELATIVE_TIME.PAST.FEW_SECONDS);
  } else if (diffSeconds < 90) {
    return translateService.instant(T.GLOBAL_RELATIVE_TIME.PAST.A_MINUTE);
  } else if (diffMinutes < 45) {
    return translateService.instant(T.GLOBAL_RELATIVE_TIME.PAST.MINUTES, {
      count: diffMinutes,
    });
  } else if (diffMinutes < 90) {
    return translateService.instant(T.GLOBAL_RELATIVE_TIME.PAST.AN_HOUR);
  } else if (diffHours < 22) {
    return translateService.instant(T.GLOBAL_RELATIVE_TIME.PAST.HOURS, {
      count: diffHours,
    });
  } else if (diffHours < 36) {
    return translateService.instant(T.GLOBAL_RELATIVE_TIME.PAST.A_DAY);
  } else if (diffDays < 25) {
    return translateService.instant(T.GLOBAL_RELATIVE_TIME.PAST.DAYS, {
      count: diffDays,
    });
  } else if (diffDays < 45) {
    return translateService.instant(T.GLOBAL_RELATIVE_TIME.PAST.A_MONTH);
  } else if (diffMonths < 11) {
    return translateService.instant(T.GLOBAL_RELATIVE_TIME.PAST.MONTHS, {
      count: diffMonths,
    });
  } else if (diffYears <= 1) {
    return translateService.instant(T.GLOBAL_RELATIVE_TIME.PAST.A_YEAR);
  } else {
    return translateService.instant(T.GLOBAL_RELATIVE_TIME.PAST.YEARS, {
      count: diffYears,
    });
  }
};
