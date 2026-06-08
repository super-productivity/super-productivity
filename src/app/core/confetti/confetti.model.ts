export interface ConfettiConfig {
  particleCount?: number;
  angle?: number;
  spread?: number;
  startVelocity?: number;
  decay?: number;
  gravity?: number;
  drift?: number;
  flat?: boolean;
  ticks?: number;
  origin?: { x?: number; y?: number };
  colors?: string[];
  shapes?: (string | Shape)[];
  scalar?: number;
  zIndex?: number;
  disableForReducedMotion?: boolean;
}

interface Shape {
  type: 'path' | 'bitmap';
  path?: string;
  matrix: DOMMatrix;
  bitmap?: ImageBitmap;
}

/**
 * A confetti instance bound to a specific canvas (via `confetti.create`).
 * `reset()` stops the animation loop and removes the auto-resize listener.
 */
export interface ConfettiInstance {
  (props: ConfettiConfig): Promise<void> | null;
  reset: () => void;
}
