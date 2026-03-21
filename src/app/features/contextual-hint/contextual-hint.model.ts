import { TourId } from '../shepherd/shepherd-steps.const';

export interface ContextualHint {
  readonly id: string;
  readonly icon: string;
  readonly titleKey: string;
  readonly messageKey: string;
  readonly maxImpressions: number;
  readonly actionLabelKey?: string;
  readonly actionRoute?: string;
  readonly actionTourId?: TourId;
}

export interface ContextualHintState {
  version: number;
  dismissed: string[];
  impressions: Record<string, number>;
}

export const CONTEXTUAL_HINT_STATE_VERSION = 1;
