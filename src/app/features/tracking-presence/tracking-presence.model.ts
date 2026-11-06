/**
 * Ephemeral cross-device tracking presence (SuperSync only).
 *
 * These payloads travel over the SuperSync WebSocket as opaque strings
 * (E2E-encrypted when sync encryption is on) and are NEVER persisted — not in
 * the op-log, not on the server disk. Time accounting stays entirely on the
 * existing `syncTimeSpent` op path; presence is display + remote control only.
 */

export type TrackingPresenceState = 'tracking' | 'stopped';

export interface TrackingPresencePayload {
  v: 1;
  /**
   * Minted per tracking session (a task switch starts a new session). Used as
   * a CAS guard: a remote stop command names the session it intends to stop,
   * and the producer ignores a stop for a session it no longer runs.
   */
  sessionId: string;
  /** Producer-side monotonic counter; viewers drop out-of-order messages. */
  seq: number;
  state: TrackingPresenceState;
  /**
   * Decoration on `stopped`: the producer's idle detection paused tracking
   * (the idle dialog is open). Viewers render this as "Paused" without a Stop
   * action — nothing is running to stop, and the idle-time-assignment
   * decision can only be made on the producing device.
   */
  reason?: 'idle';
  taskId: string | null;
  /** Wall-clock ms of the session start. Display only — never accounting. */
  sinceTs: number;
  /** Human-readable producer device label, e.g. 'Desktop', 'Android'. */
  deviceLabel: string;
  /**
   * Focus-session cycle, present while one runs on the producer. Read-only
   * mirror — v1 offers no remote focus control (the focus flow has phases,
   * breaks and a completion ceremony; there is no coherent single remote verb).
   */
  focusCycle?: number;
}

export interface TrackingPresenceCmd {
  v: 1;
  cmd: 'stop';
  /** CAS guard — must match the producer's current sessionId (see above). */
  sessionId: string;
  /** Label of the commanding device for producer-side attribution. */
  deviceLabel: string;
}

/**
 * The opaque string relayed by the server is this envelope, JSON-encoded.
 * `data` is the JSON-encoded payload/cmd — E2E-encrypted (via
 * OperationEncryptionService) when `enc` is true.
 */
export interface TrackingPresenceEnvelope {
  enc: boolean;
  data: string;
}

/** What viewers render: the last remote state plus transport metadata. */
export interface RemoteTrackingSession {
  payload: TrackingPresencePayload;
  /** False once the producing device's socket is gone (state may be stale). */
  producerConnected: boolean;
  receivedAt: number;
}

/**
 * Derived render state shared by every viewer surface (header pill, Android
 * notification), computed once in TrackingPresenceService so "past tense + no
 * Stop when stale" can never diverge between surfaces.
 */
export interface RemoteSessionView {
  session: RemoteTrackingSession;
  /** Producer socket gone or no heartbeat for PRESENCE_STALE_AFTER_MS. */
  isStale: boolean;
  /** Translation key for the state line (TRACKING_ON / PAUSED_ON / ...). */
  stateKey: string;
  /** Translation key for the time part (SINCE / LAST_SEEN). */
  timeKey: string;
  /** Timestamp to format into `timeKey` (sinceTs, or receivedAt when stale). */
  timeTs: number;
  /** Stop is only offered against a live, actually-tracking producer. */
  showStop: boolean;
}

/** Producer re-announces while tracking, so viewers can detect staleness. */
export const PRESENCE_HEARTBEAT_MS = 60_000;
/** Viewer keeps a plain `stopped` visible this long (task-switch anti-flap). */
export const PRESENCE_STOPPED_LINGER_MS = 10_000;
/** Viewer renders past tense / drops the Stop action after this silence. */
export const PRESENCE_STALE_AFTER_MS = 90_000;
/** Viewer hides a stale remote session entirely after this long. */
export const PRESENCE_HIDE_STALE_AFTER_MS = 30 * 60_000;
