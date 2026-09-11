import { clearSessionKeyCache, setArgon2ParamsForTesting } from '@sp/sync-core';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';
import {
  getRepeatableSubTaskId,
  getRepeatableTaskId,
} from '../task-repeat-cfg/get-repeatable-task-id.util';
import {
  TrackingPresenceEnvelope,
  TrackingPresencePayload,
} from './tracking-presence.model';
import { MAX_DEVICE_LABEL_LENGTH } from './get-device-label.util';

/**
 * Pins the wire size of a maximal presence frame against the pre-18.21
 * server's websocket `maxPayload` of 1024 bytes. An oversized frame does not
 * merely drop the presence message — it errors the WHOLE sync socket, so a
 * presence payload growing past the limit silently breaks sync against every
 * not-yet-updated server. If this spec fails, shrink the payload (or gate the
 * new field) instead of raising the numbers.
 */
const PRE_18_21_SERVER_MAX_PAYLOAD_BYTES = 1024;
/** Slack kept free for future payload fields before old servers error. */
const HEADROOM_BYTES = 200;

describe('tracking-presence wire size', () => {
  // Real encryption with weakened Argon2 params, as OperationEncryptionService
  // prescribes for tests. Key derivation params do not change ciphertext size:
  // encrypt() emits base64(salt(16) + iv(12) + plaintext + GCM tag(16)).
  beforeAll(() => {
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
  });

  afterAll(() => {
    setArgon2ParamsForTesting();
    clearSessionKeyCache();
  });

  // Longest realistic taskId: a deterministic repeat-instance SUBTASK id —
  // `rpt_<21-char nanoid cfg id>_<YYYY-MM-DD>_sub_<index>` (~43 chars).
  const maxTaskId = getRepeatableSubTaskId(
    getRepeatableTaskId('x'.repeat(21), '2026-12-31'),
    99,
  );

  // Every field at its realistic maximum. `state`/`reason` use the longest
  // enum values (they never co-occur in practice — deliberate over-count);
  // the label is the sanitizer's cap in 3-byte UTF-8 chars (96 bytes at 32).
  const maximalPayload: TrackingPresencePayload = {
    v: 1,
    sessionId: 's'.repeat(21), // nanoid() default length
    seq: Number.MAX_SAFE_INTEGER,
    state: 'tracking',
    reason: 'idle',
    taskId: maxTaskId,
    sinceTs: Number.MAX_SAFE_INTEGER,
    deviceLabel: '木'.repeat(MAX_DEVICE_LABEL_LENGTH),
    focusCycle: Number.MAX_SAFE_INTEGER,
  };

  // Mirrors the real wire path: TrackingPresenceService._doSend wraps the
  // (possibly encrypted) payload in the envelope and sendPresence()
  // JSON-stringifies { type, payload } as the actual websocket frame.
  const toWireFrame = (envelope: TrackingPresenceEnvelope): string =>
    JSON.stringify({ type: 'presence_state', payload: JSON.stringify(envelope) });

  const utf8Bytes = (frame: string): number => new TextEncoder().encode(frame).length;

  it('keeps a maximal encrypted state frame under the pre-18.21 frame limit', async () => {
    // The exact encrypt path the service uses for sends.
    const data = await new OperationEncryptionService().encryptPayload(
      maximalPayload,
      'wire-size-test-password',
    );
    const frame = toWireFrame({ enc: true, data });

    expect(utf8Bytes(frame)).toBeLessThan(
      PRE_18_21_SERVER_MAX_PAYLOAD_BYTES - HEADROOM_BYTES,
    );
  });

  it('keeps a maximal plaintext state frame under the pre-18.21 frame limit', () => {
    // E2EE off: the payload JSON is double-nested in JSON strings, so every
    // quote costs escaping twice — measured here rather than hand-derived.
    const frame = toWireFrame({ enc: false, data: JSON.stringify(maximalPayload) });

    expect(utf8Bytes(frame)).toBeLessThan(
      PRE_18_21_SERVER_MAX_PAYLOAD_BYTES - HEADROOM_BYTES,
    );
  });
});
