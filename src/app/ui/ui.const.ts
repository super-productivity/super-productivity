export const UI_LONG_PRESS_DURATION = 600;

// Same distance and metric as the CDK's default `dragStartThreshold`: a press
// that moves this far is a scroll or a drag, never a long-press. Because a CDK
// drag needs the same movement to start, the two can't both begin.
export const UI_LONG_PRESS_MOVE_TOLERANCE_PX = 5;
