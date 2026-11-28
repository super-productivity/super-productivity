export const ANI_STANDARD_TIMING_ = 'cubic-bezier(.4, 0, .2, 1)';
export const ANI_ENTER_TIMING_ = 'cubic-bezier(0, 0, .2, 1)';
export const ANI_LEAVE_TIMING_ = 'cubic-bezier(.4, 0, 1, 1)';

export const TRANSITION_DURATION_S = '150ms';
// If this grows past ~400ms, revisit ACTION_ROW_REVEAL_PIN_MS in
// main-header.component.ts: the header's reveal pin must outlive the right
// panel's width animation (ANI_ENTER_TIMING), which is built from this.
export const TRANSITION_DURATION_M = '225ms';
export const TRANSITION_DURATION_L = '375ms';
export const TRANSITION_DURATION_XL = '1s';

export const TRANSITION_DURATION_ENTER = TRANSITION_DURATION_M;
export const TRANSITION_DURATION_LEAVE = '195ms';

export const ANI_STANDARD_TIMING = `${TRANSITION_DURATION_M} ${ANI_STANDARD_TIMING_}`;
export const ANI_LONG_TIMING = `${TRANSITION_DURATION_L} ${ANI_STANDARD_TIMING_}`;
export const ANI_VERY_LONG_TIMING = `${TRANSITION_DURATION_XL} ${ANI_STANDARD_TIMING_}`;
export const ANI_ENTER_TIMING = `${TRANSITION_DURATION_ENTER} ${ANI_ENTER_TIMING_}`;
export const ANI_LEAVE_TIMING = `${TRANSITION_DURATION_LEAVE} ${ANI_LEAVE_TIMING_}`;

export const ANI_FAST_TIMING = `${TRANSITION_DURATION_M} ${ANI_STANDARD_TIMING_}`;
