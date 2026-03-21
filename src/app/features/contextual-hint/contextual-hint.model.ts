export interface ContextualHint {
  readonly id: string;
  readonly icon: string;
  readonly title: string;
  readonly message: string;
  readonly maxImpressions: number;
  readonly actionLabel?: string;
  readonly actionRoute?: string;
  readonly actionTourId?: string;
}

export interface ContextualHintState {
  dismissed: string[];
  impressions: Record<string, number>;
}
