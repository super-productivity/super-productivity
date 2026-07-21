import { DAILY_STATE } from '../metric-scoring.util';
import { MetricCopy } from '../metric.model';
import { T } from '../../../t.const';

export interface DailyStateInfo {
  icon: string;
  headlineKey: string;
  hintKey: string;
}

const getFocusMinutes = (metric: MetricCopy | undefined): number => {
  const focusSessions = metric?.focusSessions ?? [];
  if (!focusSessions.length) {
    return 0;
  }
  const totalMs = focusSessions.reduce((sum, session) => sum + session, 0);
  return totalMs / (1000 * 60);
};

export const getDailyStateInfo = (
  metric: MetricCopy | undefined,
  productivityScore: number,
  sustainabilityScore: number,
): DailyStateInfo => {
  const threshold = DAILY_STATE.THRESHOLD;
  const isHighProductivity = productivityScore > threshold;
  const isHighSustainability = sustainabilityScore >= threshold;
  const isMidProductivity = productivityScore >= 40 && productivityScore <= threshold;
  const impactRating = metric?.impactOfWork ?? null;
  const focusMinutes = getFocusMinutes(metric);
  const isLowImpact = impactRating === 1;
  const isExtendedFocus = focusMinutes >= 150;

  let stateKey:
    | 'DEEP_FLOW'
    | 'STEADY'
    | 'OVERDRIVE'
    | 'RECOVERY'
    | 'IMPACT_MISMATCH'
    | 'DRIFT';

  if (isHighSustainability && isLowImpact && isExtendedFocus) {
    stateKey = 'IMPACT_MISMATCH';
  } else if (isHighProductivity && isHighSustainability) {
    stateKey = 'DEEP_FLOW';
  } else if (isMidProductivity && isHighSustainability) {
    stateKey = 'STEADY';
  } else if (isHighProductivity) {
    stateKey = 'OVERDRIVE';
  } else if (isHighSustainability) {
    stateKey = 'RECOVERY';
  } else {
    stateKey = 'DRIFT';
  }

  const stateMap: Record<typeof stateKey, DailyStateInfo> = {
    DEEP_FLOW: {
      icon: '🪄',
      headlineKey: T.F.METRIC.EVAL_FORM.STATE_DEEP_FLOW_HEADLINE,
      hintKey: T.F.METRIC.EVAL_FORM.STATE_DEEP_FLOW_HINT,
    },
    STEADY: {
      icon: '✅',
      headlineKey: T.F.METRIC.EVAL_FORM.STATE_STEADY_HEADLINE,
      hintKey: T.F.METRIC.EVAL_FORM.STATE_STEADY_HINT,
    },
    OVERDRIVE: {
      icon: '⚡',
      headlineKey: T.F.METRIC.EVAL_FORM.STATE_OVERDRIVE_HEADLINE,
      hintKey: T.F.METRIC.EVAL_FORM.STATE_OVERDRIVE_HINT,
    },
    RECOVERY: {
      icon: '🌱',
      headlineKey: T.F.METRIC.EVAL_FORM.STATE_RECOVERY_HEADLINE,
      hintKey: T.F.METRIC.EVAL_FORM.STATE_RECOVERY_HINT,
    },
    IMPACT_MISMATCH: {
      icon: '🎯',
      headlineKey: T.F.METRIC.EVAL_FORM.STATE_IMPACT_MISMATCH_HEADLINE,
      hintKey: T.F.METRIC.EVAL_FORM.STATE_IMPACT_MISMATCH_HINT,
    },
    DRIFT: {
      icon: '🌊',
      headlineKey: T.F.METRIC.EVAL_FORM.STATE_DRIFT_HEADLINE,
      hintKey: T.F.METRIC.EVAL_FORM.STATE_DRIFT_HINT,
    },
  };

  return stateMap[stateKey];
};
