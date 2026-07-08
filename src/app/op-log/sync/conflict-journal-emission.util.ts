/**
 * SPAP-13 — Pure classification of an LWW resolution into a conflict-journal
 * entry (SPAP-12 taxonomy). No Angular, no I/O — deterministic apart from `id`
 * (uuidv7) and `resolvedAt` (Date.now), so the taxonomy is unit-testable in
 * isolation.
 *
 * OBSERVE-ONLY: this only READS the already-decided resolution plan; it never
 * changes which op LWW picked.
 */

import { OpType } from '../core/operation.types';
import type { EntityType, Operation } from '../core/operation.types';
import { extractActionPayload, extractEntityFromPayload } from '@sp/sync-core';
import type { LwwConflictResolutionReason } from '@sp/sync-core';
import { uuidv7 } from '../../util/uuid-v7';
import {
  ConflictJournalEntry,
  ConflictJournalFieldDiff,
  ConflictJournalReason,
  ConflictJournalStatus,
  ConflictJournalWinner,
  NOISE_FIELDS,
} from './conflict-journal.model';
import {
  buildMergedFieldDiffs,
  mergeChangedFields,
} from './conflict-disjoint-merge.util';

/** Everything the classifier needs about one resolved conflict. */
export interface ConflictJournalClassificationInput {
  entityType: EntityType;
  entityId: string;
  winner: ConflictJournalWinner;
  /** The plan reason from `planLwwConflictResolutions` (archive detection etc.). */
  planReason: LwwConflictResolutionReason;
  localOps: Operation[];
  remoteOps: Operation[];
  /**
   * True when this conflict only exists because `_adjustForClockCorruption`
   * escalated a non-CONCURRENT comparison to CONCURRENT.
   */
  isCorruptionSuspected: boolean;
  /** Resolves the payload key (e.g. 'task') for an entity type. */
  resolvePayloadKey: (entityType: EntityType) => string;
}

const ARCHIVE_PLAN_REASONS: ReadonlySet<LwwConflictResolutionReason> = new Set([
  'remote-archive',
  'local-archive',
  'local-archive-sibling',
]);

const firstString = (...vals: unknown[]): string | undefined => {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) {
      return v;
    }
  }
  return undefined;
};

/** Best-effort human title for the entity, from the op payloads only. */
const extractEntityTitle = (
  ops: Operation[],
  changes: Record<string, unknown>,
  payloadKey: string,
): string => {
  const fromChanges = firstString(changes['title'], changes['name']);
  if (fromChanges) {
    return fromChanges;
  }
  for (const op of ops) {
    const entity = extractEntityFromPayload(op.payload, payloadKey) as
      | Record<string, unknown>
      | undefined;
    const title = firstString(entity?.['title'], entity?.['name']);
    if (title) {
      return title;
    }
    // Fallback: some payloads nest the fields directly under the action payload.
    const action = extractActionPayload(op.payload);
    const nested = firstString(action?.['title'], action?.['name']);
    if (nested) {
      return nested;
    }
  }
  return '';
};

const maxTimestamp = (ops: Operation[]): number =>
  ops.length ? Math.max(...ops.map((op) => op.timestamp)) : 0;

/**
 * Classifies one already-resolved LWW conflict into a journal entry.
 *
 * Precedence: clock-corruption → delete-wins → noise → newer/tie.
 *
 * `noise` fires when the DISCARDED (losing) side changed only NOISE_FIELDS — i.e.
 * nothing real was lost. This is the data-safety-correct reading of "only NOISE
 * fields overlap": a real edit is only lost if the loser touched a non-noise field.
 */
export const buildConflictJournalEntry = (
  input: ConflictJournalClassificationInput,
): ConflictJournalEntry => {
  const {
    entityType,
    entityId,
    winner,
    planReason,
    localOps,
    remoteOps,
    isCorruptionSuspected,
    resolvePayloadKey,
  } = input;

  const payloadKey = resolvePayloadKey(entityType);
  const localChanges = mergeChangedFields(localOps, payloadKey);
  const remoteChanges = mergeChangedFields(remoteOps, payloadKey);

  const localTs = maxTimestamp(localOps);
  const remoteTs = maxTimestamp(remoteOps);

  // SPAP-14: disjoint-field auto-merge. Nothing was discarded — BOTH sides'
  // changes survive in the synthesized merged op — so this is informational,
  // never counts toward the unreviewed count, and records per-field which side
  // supplied each value. Early-return keeps the LWW classification below (which
  // narrows `winner` to 'local' | 'remote') completely unchanged.
  if (winner === 'merged') {
    const localClientId = localOps[0]?.clientId ?? '';
    const remoteClientId = remoteOps[0]?.clientId ?? '';
    const mergedTitle =
      extractEntityTitle(localOps, localChanges, payloadKey) ||
      extractEntityTitle(remoteOps, remoteChanges, payloadKey);
    return {
      id: uuidv7(),
      entityType,
      entityId,
      entityTitle: mergedTitle,
      resolvedAt: Date.now(),
      winner: 'merged',
      reason: 'disjoint-merge',
      fieldDiffs: buildMergedFieldDiffs(
        localChanges,
        remoteChanges,
        { timestamp: localTs, clientId: localClientId },
        { timestamp: remoteTs, clientId: remoteClientId },
      ),
      localClientId,
      remoteClientId,
      localTs,
      remoteTs,
      status: 'info',
    };
  }

  // fieldDiffs: union of changed fields on both sides, capturing each side's
  // value VERBATIM so the loser's discarded values are preserved.
  const fieldNames = Array.from(
    new Set([...Object.keys(localChanges), ...Object.keys(remoteChanges)]),
  );
  const fieldDiffs: ConflictJournalFieldDiff[] = fieldNames.map((field) => ({
    field,
    localVal: localChanges[field],
    remoteVal: remoteChanges[field],
    pickedSide: winner,
  }));

  const winnerOps = winner === 'local' ? localOps : remoteOps;
  const loserChanges = winner === 'local' ? remoteChanges : localChanges;
  const loserRealFields = Object.keys(loserChanges).filter(
    (field) => !NOISE_FIELDS.has(field),
  );

  const isDeleteWin =
    ARCHIVE_PLAN_REASONS.has(planReason) ||
    winnerOps.some((op) => op.opType === OpType.Delete);

  let reason: ConflictJournalReason;
  let status: ConflictJournalStatus;
  if (isCorruptionSuspected) {
    reason = 'clock-corruption-suspected';
    status = 'unreviewed';
  } else if (isDeleteWin) {
    reason = 'delete-wins';
    status = 'unreviewed';
  } else if (loserRealFields.length === 0) {
    reason = 'noise';
    status = 'info';
  } else {
    reason = localTs === remoteTs ? 'tie' : 'newer';
    status = 'unreviewed';
  }

  const title =
    extractEntityTitle(
      winnerOps,
      winner === 'local' ? localChanges : remoteChanges,
      payloadKey,
    ) ||
    extractEntityTitle(
      winner === 'local' ? remoteOps : localOps,
      loserChanges,
      payloadKey,
    );

  return {
    id: uuidv7(),
    entityType,
    entityId,
    entityTitle: title,
    resolvedAt: Date.now(),
    winner,
    reason,
    fieldDiffs,
    localClientId: localOps[0]?.clientId ?? '',
    remoteClientId: remoteOps[0]?.clientId ?? '',
    localTs,
    remoteTs,
    status,
  };
};
