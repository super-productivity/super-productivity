/**
 * Dwell tracking: a match only fires after it has stayed the foreground match
 * for `dwellMs`, and fires once until a different match takes over.
 *
 * Unmatched samples (unmapped apps, lock screen) do not reset the candidate, so a
 * quick look at chat keeps the clock running. A gap longer than `maxGapMs` since
 * the candidate was last seen does restart it: a glance 30 min ago is no dwell.
 */
export interface DwellState {
  candidateId: string | null;
  since: number;
  lastSeenAt: number;
  hasFired: boolean;
}

export const INITIAL_DWELL_STATE: DwellState = {
  candidateId: null,
  since: 0,
  lastSeenAt: 0,
  hasFired: false,
};

export interface DwellTiming {
  dwellMs: number;
  maxGapMs: number;
}

export interface DwellStep {
  state: DwellState;
  /** Task id to act on now, if the dwell time just elapsed. */
  fireId: string | null;
}

export const stepDwell = (
  state: DwellState,
  sample: { matchId: string | null; now: number },
  { dwellMs, maxGapMs }: DwellTiming,
): DwellStep => {
  const { matchId, now } = sample;
  if (matchId === null) {
    return { state, fireId: null };
  }
  if (matchId !== state.candidateId || now - state.lastSeenAt > maxGapMs) {
    return {
      state: { candidateId: matchId, since: now, lastSeenAt: now, hasFired: false },
      fireId: null,
    };
  }
  const seen = { ...state, lastSeenAt: now };
  if (!state.hasFired && now - state.since >= dwellMs) {
    return { state: { ...seen, hasFired: true }, fireId: matchId };
  }
  return { state: seen, fireId: null };
};

/** Whether `id` is still the candidate and was seen within `maxAgeMs`. */
export const isRecentCandidate = (
  state: DwellState,
  id: string,
  { now, maxAgeMs }: { now: number; maxAgeMs: number },
): boolean => state.candidateId === id && now - state.lastSeenAt <= maxAgeMs;
