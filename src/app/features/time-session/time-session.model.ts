export interface TimeSession {
  id: string;
  /** Work day. */
  d: string;
  /** UTC start, absent for duration-only entries. */
  s?: number;
  /** Duration in milliseconds. */
  t: number;
  /** Offset at recording time. */
  o?: number;
}
