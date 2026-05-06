// TODO correct type
import { BaseIssueProviderCfg } from '../../issue.model';
import { CalendarIntegrationEvent } from '../../../calendar-integration/calendar-integration.model';

export interface CalendarProviderCfg extends BaseIssueProviderCfg {
  icalUrl: string;
  isAutoImportForCurrentDay: boolean;
  icon?: string;
  checkUpdatesEvery: number;
  showBannerBeforeThreshold: number | null | undefined;
  isDisabledForWebApp?: boolean;
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
