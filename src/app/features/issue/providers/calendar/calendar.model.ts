// TODO correct type
import { BaseIssueProviderCfg } from '../../issue.model';
import { CalendarIntegrationEvent } from '../../../calendar-integration/calendar-integration.model';

export interface CalendarProviderCfg extends BaseIssueProviderCfg {
  icalUrl: string;
  // Human-readable calendar name taken from the feed's X-WR-CALNAME property.
  // Captured on fetch so lists/tooltips can show it instead of the hostname.
  calName?: string;
  isAutoImportForCurrentDay: boolean;
  isReferenceCalendar?: boolean;
  color?: string;
  icon?: string;
  checkUpdatesEvery: number;
  showBannerBeforeThreshold: number | null | undefined;
  isDisabledForWebApp?: boolean;
  filterIncludeRegex?: string | null;
  filterExcludeRegex?: string | null;
}

export type LegacyCalendarProvider = Readonly<{
  isEnabled: boolean;
  id: string;
  icalUrl: string;
  defaultProjectId: string | null;
  checkUpdatesEvery: number;
  showBannerBeforeThreshold: null | number;
}>;

export type CalendarContextInfoTarget = 'GOOGLE' | 'OUTLOOK365' | 'OTHER';

export interface ICalIssue extends CalendarIntegrationEvent {
  id: string;
}

export type ICalIssueReduced = ICalIssue;
