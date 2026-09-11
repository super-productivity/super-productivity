/**
 * Utility functions for calculating productivity and sustainability metrics.
 * v2.8 - Productivity: Impact-driven with recognition for non-focus work (65/30/5 split)
 * v2.5 - Sustainability: Exponential decay + sigmoid workload model
 * Includes robust fallbacks and heuristics for missing data.
 */

import { Metric } from './metric.model';

// ==================== SCORING CONSTANTS ====================

export const PRODUCTIVITY_WEIGHTS = {
  IMPACT: 0.65, // User's assessment of work significance (primary driver)
  FOCUS: 0.3, // Progress toward deep work target (full credit at target, flat beyond)
  TOTAL_WORK: 0.05, // Credit for overall effort (capped at 10h)
} as const;

/**
 * Sustainability Score Weights (must sum to 1.0)
 * Freshness leads to emphasize energy and burnout prevention.
 */
export const SUSTAINABILITY_WEIGHTS = {
  FRESHNESS: 0.45, // Energy level (from check-in or neutral fallback)
  WORKLOAD: 0.4, // Reasonable work hours (penalizes overwork)
  FOCUS_BALANCE: 0.15, // Inverted-V curve - optimal at 4h, penalizes excess
} as const;

/**
 * Default time targets and limits (in minutes)
 */
export const TIME_TARGETS = {
  DEFAULT_TARGET_FOCUSED_MINUTES: 240, // 4 hours - optimal deep work target
  DEFAULT_MAX_WORK_MINUTES: 600, // 10 hours - cap for total work credit in productivity
  FOCUS_BALANCE_PEAK_MINUTES: 240, // 4 hours - optimal focus time for sustainability
} as const;

/**
 * Scale conversions for user inputs
 */
export const SCALE_CONVERSIONS = {
  IMPACT_SCALE_MAX: 4, // Impact rating is 1-4 (simplified from 1-5)
  ENERGY_CHECKIN_MIN: 1, // Energy check-in is 1-3
  ENERGY_CHECKIN_DIVISOR: 2, // Convert (value - 1) / 2 to get 0-1 range
} as const;

export const FOCUS_BALANCE_DECAY = {
  BETA: 0.00001, // Exponential decay rate for excessive focus (β parameter)
} as const;

export const WORKLOAD_SIGMOID = {
  INFLECTION_POINT: 480, // 8 hours - point where workload score is 0
  STEEPNESS: 0.01, // Controls how quickly score changes around inflection point
} as const;

/**
 * Daily state classification threshold
 */
export const DAILY_STATE = {
  THRESHOLD: 50, // Score >= 50 is considered "high" for both dimensions
} as const;

/**
 * Default fallback values
 */
export const DEFAULTS = {
  FRESHNESS_NEUTRAL: 0.5, // Neutral energy level when no data provided
} as const;

/**
 * Color gradient parameters for score visualization
 */
export const COLOR_GRADIENT = {
  HUE_MIN: 0, // Red (poor score)
  HUE_MAX: 120, // Green (excellent score)
  SATURATION: 60, // Saturation percentage
  LIGHTNESS_START: 40, // Lightness for gradient start
  LIGHTNESS_END: 40, // Lightness for gradient end
} as const;

// ==================== HELPER FUNCTIONS ====================

/**
 * Helper: Clamps a value between specified bounds (default 0-1).
 * @param value - Value to clamp
 * @param min - Minimum bound (default 0)
 * @param max - Maximum bound (default 1)
 * @returns Clamped value between min and max
 */
const clamp = (value: number, min: number = 0, max: number = 1): number =>
  Math.max(min, Math.min(max, value));

/**
 * Helper: Safe division with fallback for zero denominator.
 * @param numerator - Value to divide
 * @param denominator - Value to divide by
 * @param fallback - Value to return if denominator is zero (default 0)
 * @returns Result of division or fallback
 */
const safeDiv = (numerator: number, denominator: number, fallback: number = 0): number =>
  denominator > 0 ? numerator / denominator : fallback;

/**
 * Converts a list of focus session durations (ms) into total minutes.
 */
export const focusSessionsToMinutes = (focusSessions: number[]): number => {
  if (!focusSessions || focusSessions.length === 0) {
    return 0;
  }
  const totalMs = focusSessions.reduce((sum, session) => sum + session, 0);
  return totalMs / (1000 * 60);
};

/**
 * Calculates a productivity score (0-100) with impact rating as the primary driver.
 *
 * v2.8 - Impact-driven model with recognition for non-focus work:
 * - 65% Impact Rating: User's assessment of work value/significance (1-4, required)
 * - 30% Focus Progress: Progress toward deep work goal (full credit at target, flat beyond)
 * - 5% Total Work: Credit for overall effort (capped at 10 hours)
 *
 * Making impact rating mandatory ensures users reflect on work value, not just time spent,
 * while still rewarding meaningful focus time and broader contributions beyond deep work.
 *
 * Focus beyond the target earns no extra credit, but is never penalized either — the
 * score must not drop when focus time increases (overwork is penalized by the
 * sustainability score instead).
 *
 * @param impactRating - User's assessment of work impact (1-4 scale, REQUIRED)
 * @param focusedMinutes - Total focused time for the day (in minutes)
 * @param totalWorkMinutes - Total work time including non-focus tasks (in minutes)
 * @param targetFocusedMinutes - Target deep work goal (in minutes, default 240 = 4 hours)
 * @param maxWorkMinutes - Cap for total work contribution (in minutes, default 600 = 10 hours)
 * @returns Productivity score from 0-100
 *
 * @example
 * // High impact, met default target = perfect score
 * calculateProductivityScore(4, 240, 600) // Returns 100
 *
 * @example
 * // Medium impact, typical day
 * calculateProductivityScore(2, 180, 360) // Returns ~58
 *
 * @example
 * // Low impact despite good focus = moderate score
 * calculateProductivityScore(1, 240, 360) // Returns ~49
 */
export const calculateProductivityScore = (
  impactRating: number,
  focusedMinutes: number,
  totalWorkMinutes: number = focusedMinutes,
  targetFocusedMinutes: number = TIME_TARGETS.DEFAULT_TARGET_FOCUSED_MINUTES,
  maxWorkMinutes: number = TIME_TARGETS.DEFAULT_MAX_WORK_MINUTES,
): number => {
  // Impact: User's reflection on work value (1-4 scale normalized to 0-1)
  const impact = clamp(impactRating / SCALE_CONVERSIONS.IMPACT_SCALE_MAX);

  // Progress to Target: linear growth from 0 to target, full credit at target,
  // flat beyond it. Must be continuous and non-decreasing in focusedMinutes so the
  // score never drops for doing more focused work.
  const progressRatio = safeDiv(focusedMinutes, targetFocusedMinutes, 0);
  const targetProgress = clamp(progressRatio);

  // Total work contribution (capped at maxWorkMinutes to avoid rewarding overwork)
  const totalWorkRatioRaw = safeDiv(totalWorkMinutes, maxWorkMinutes, 0);
  const totalWorkContribution = clamp(totalWorkRatioRaw);

  // Weighted components (sum = 1.0)
  const impactComponent = impact * PRODUCTIVITY_WEIGHTS.IMPACT;
  const focusComponent = targetProgress * PRODUCTIVITY_WEIGHTS.FOCUS;
  const totalWorkComponent = totalWorkContribution * PRODUCTIVITY_WEIGHTS.TOTAL_WORK;

  const score = impactComponent + focusComponent + totalWorkComponent;

  // Scale to 0-100 range
  return Math.round(score * 100);
};

/**
 * Calculates a sustainability score (0-100) to assess work-life balance and burnout risk.
 *
 * v2.5 - Improved balance model with exponential decay and sigmoid workload:
 * - 45% Freshness: Energy levels from check-in (neutral fallback when missing)
 * - 40% Workload: Sigmoid function (inflection at 8h, asymptotic decay)
 * - 15% Focus Balance: Linear growth to 4h, then exponential penalty for excess
 *
 * The focus balance curve rewards building up to 4h of focused work, but then
 * applies exponential penalty beyond 4h (cognitive fatigue is non-linear).
 * This prevents burnout from excessive deep work sessions.
 *
 * @param focusedMinutes - Total focused time for the day (in minutes)
 * @param totalWorkMinutes - Total work time including meetings, emails, etc. (in minutes)
 * @param energyCheckin - Simple energy check-in (1=exhausted, 2=ok, 3=good) - optional
 * @returns Sustainability score from 0-100
 *
 * @example
 * // Target case: 7h work, 4h focus, medium energy
 * calculateSustainabilityScore(240, 420, 2) // Returns ~49
 *
 * @example
 * // Excessive focus (6h): exponential penalty vs 4h
 * calculateSustainabilityScore(360, 420, 2) // Returns ~47 (lower than 4h)
 *
 * @example
 * // Good energy, reasonable hours, optimal focus = high score
 * calculateSustainabilityScore(240, 420, 3) // Returns ~72
 */
export const calculateSustainabilityScore = (
  focusedMinutes: number,
  totalWorkMinutes: number,
  energyCheckin?: number,
): number => {
  // Freshness: Energy level normalized to 0-1 (neutral fallback when missing)
  let freshness = DEFAULTS.FRESHNESS_NEUTRAL;
  if (energyCheckin !== undefined) {
    // energyCheckin: 1=exhausted, 2=ok, 3=good → (value-1)/2 → 0, 0.5, 1
    freshness =
      (energyCheckin - SCALE_CONVERSIONS.ENERGY_CHECKIN_MIN) /
      SCALE_CONVERSIONS.ENERGY_CHECKIN_DIVISOR;
  }
  // Workload: Sigmoid function centered at 8h (480 min)
  // Formula: 2 / (1 + exp(steepness × (minutes - inflection))) - 1
  // At 0h: ~1.0, at 8h: 0.0, at 16h: ~-1.0 (clamped to 0)
  // This provides smooth decay rather than harsh linear cutoff
  const sigmoidExponent = Math.exp(
    WORKLOAD_SIGMOID.STEEPNESS * (totalWorkMinutes - WORKLOAD_SIGMOID.INFLECTION_POINT),
  );
  // eslint-disable-next-line no-mixed-operators
  const sigmoidValue = 2 / (1 + sigmoidExponent) - 1;
  const workloadScore = clamp(sigmoidValue, 0, 1);

  // Focus Balance: Inverted-V curve with peak at optimal focus time
  // Up to optimal: linear increase rewards building focus
  // Beyond optimal: exponential decay penalizes excessive deep work
  let focusBalance: number;
  const peakMinutes = TIME_TARGETS.FOCUS_BALANCE_PEAK_MINUTES;
  if (focusedMinutes <= peakMinutes) {
    // Building up to optimal: 0h=0, peak=1 (linear growth)
    focusBalance = clamp(focusedMinutes / peakMinutes);
  } else {
    // Beyond optimal: exponential decay (matches non-linear fatigue)
    // Formula: exp(-β × (minutes - peak)²)
    // This approaches 0 asymptotically but never reaches it
    const excess = focusedMinutes - peakMinutes;
    focusBalance = Math.exp(-FOCUS_BALANCE_DECAY.BETA * excess * excess);
  }

  // Weighted components (sum = 1.0)
  const freshnessComponent = freshness * SUSTAINABILITY_WEIGHTS.FRESHNESS;
  const workloadComponent = workloadScore * SUSTAINABILITY_WEIGHTS.WORKLOAD;
  const focusBalanceComponent = focusBalance * SUSTAINABILITY_WEIGHTS.FOCUS_BALANCE;

  const score = freshnessComponent + workloadComponent + focusBalanceComponent;

  // Scale to 0-100 range
  return Math.round(score * 100);
};

/**
 * Determines the overall daily state based on productivity and sustainability scores.
 *
 * Uses a quadrant system with 50 as the threshold for both dimensions:
 * - DEEP_FLOW: High productivity + High sustainability (ideal state)
 * - OVERDRIVE: High productivity + Low sustainability (burnout risk)
 * - RECOVERY: Low productivity + High sustainability (rest/recharge)
 * - DRIFT: Low productivity + Low sustainability (attention needed)
 *
 * @param productivityScore - Productivity score (0-100)
 * @param sustainabilityScore - Sustainability score (0-100)
 * @param threshold - Threshold for high/low classification (default 50)
 * @returns Daily state classification
 */
export type DailyState = 'DEEP_FLOW' | 'OVERDRIVE' | 'RECOVERY' | 'DRIFT';

export const calculateDailyState = (
  productivityScore: number,
  sustainabilityScore: number,
  threshold: number = DAILY_STATE.THRESHOLD,
): DailyState => {
  const isProductivityHigh = productivityScore >= threshold;
  const isSustainabilityHigh = sustainabilityScore >= threshold;

  if (isProductivityHigh && isSustainabilityHigh) {
    return 'DEEP_FLOW'; // Sweet spot: productive and sustainable
  } else if (isProductivityHigh && !isSustainabilityHigh) {
    return 'OVERDRIVE'; // Warning: productive but burning out
  } else if (!isProductivityHigh && isSustainabilityHigh) {
    return 'RECOVERY'; // Rest phase: sustainable but low output
  } else {
    return 'DRIFT'; // Alert: neither productive nor sustainable
  }
};

/**
 * Generates a color gradient (red to green) based on a score value.
 *
 * Provides visual feedback on score quality:
 * - 0-33: Red (poor)
 * - 34-66: Yellow/Orange (moderate)
 * - 67-100: Green (excellent)
 *
 * @param score - Score value (0-100)
 * @returns CSS gradient string using HSL color space
 *
 * @example
 * getScoreColorGradient(25) // Red gradient
 * getScoreColorGradient(50) // Yellow gradient
 * getScoreColorGradient(85) // Green gradient
 */
export const getScoreColorGradient = (score: number): string => {
  // Convert score (0-100) to hue range (red to green)
  const scoreRatio = score / 100;
  const hueRange = scoreRatio * COLOR_GRADIENT.HUE_MAX;
  const hue = hueRange + COLOR_GRADIENT.HUE_MIN;
  // Return gradient with configured saturation and varying lightness for depth
  const sat = COLOR_GRADIENT.SATURATION;
  const lightStart = COLOR_GRADIENT.LIGHTNESS_START;
  const lightEnd = COLOR_GRADIENT.LIGHTNESS_END;
  return `linear-gradient(135deg, hsl(${hue}, ${sat}%, ${lightStart}%) 0%, hsl(${hue}, ${sat}%, ${lightEnd}%) 100%)`;
};

// ==================== TREND & AVERAGE CALCULATIONS ====================

/**
 * Calculates the average productivity score for a list of metrics.
 * Only includes days with impactOfWork data (focus sessions can be zero).
 *
 * @param metrics - Array of metrics to average
 * @returns Average productivity score (0-100) or null if insufficient data
 */
export const calculateAverageProductivityScore = (metrics: Metric[]): number | null => {
  const scores: number[] = [];

  for (const metric of metrics) {
    // Skip metrics without required data (only impactOfWork is required)
    if (!metric.impactOfWork) {
      continue;
    }

    const focusSessions = metric.focusSessions ?? [];
    const focusedMinutes = focusSessionsToMinutes(focusSessions);
    const totalWorkMinutes = metric.totalWorkMinutes ?? focusedMinutes;
    const score = calculateProductivityScore(
      metric.impactOfWork,
      focusedMinutes,
      totalWorkMinutes,
    );

    scores.push(score);
  }

  if (scores.length === 0) {
    return null;
  }

  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Math.round(average);
};

/**
 * Calculates trend indicator by comparing current period average to previous period.
 *
 * @param currentPeriodMetrics - Metrics for current period (e.g., last 7 days)
 * @param previousPeriodMetrics - Metrics for previous period (e.g., days 8-14)
 * @returns Trend object with direction, change amount, and percentage
 */
export interface TrendIndicator {
  direction: 'up' | 'down' | 'stable';
  change: number; // Absolute change in score
  changePercent: number; // Percentage change
}

export const calculateProductivityTrend = (
  currentPeriodMetrics: Metric[],
  previousPeriodMetrics: Metric[],
): TrendIndicator | null => {
  const currentAvg = calculateAverageProductivityScore(currentPeriodMetrics);
  const previousAvg = calculateAverageProductivityScore(previousPeriodMetrics);

  if (currentAvg === null || previousAvg === null) {
    return null;
  }

  const change = currentAvg - previousAvg;
  const changePercent = previousAvg !== 0 ? (change / previousAvg) * 100 : 0;

  // Threshold for "stable" is ±2 points (to avoid noise)
  const direction = Math.abs(change) < 2 ? 'stable' : change > 0 ? 'up' : 'down';

  return {
    direction,
    change: Math.round(change),
    changePercent: Math.round(changePercent),
  };
};
