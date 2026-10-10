/**
 * Dwell tracking: a match only fires after it has stayed the foreground match
 * for `dwellMs`, and fires once until a different match takes over.
 *
 * Samples without a match (unmapped apps, Super Productivity itself, lock screen)
 * leave the state untouched, so a quick look at chat does not restart the clock.
 */
export interface DwellState {
  candidateId: string | null;
  since: number;
  hasFired: boolean;
}

export const INITIAL_DWELL_STATE: DwellState = {
  candidateId: null,
  since: 0,
  hasFired: false,
};

export interface DwellStep {
  state: DwellState;
  /** Task id to act on now, if the dwell time just elapsed. */
  fireId: string | null;
}

export const stepDwell = (
  state: DwellState,
  matchId: string | null,
  now: number,
  dwellMs: number,
): DwellStep => {
  if (matchId === null) {
    return { state, fireId: null };
  }
  if (matchId !== state.candidateId) {
    return {
      state: { candidateId: matchId, since: now, hasFired: false },
      fireId: null,
    };
  }
  if (!state.hasFired && now - state.since >= dwellMs) {
    return { state: { ...state, hasFired: true }, fireId: matchId };
  }
  return { state, fireId: null };
};
