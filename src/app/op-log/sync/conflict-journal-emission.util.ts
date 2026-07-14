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
  hasOpaqueChanges,
  isOpaqueChangeOp,
  mergeChangedFields,
} from './conflict-disjoint-merge.util';
import { isMultiEntityOperation } from '../util/get-op-entity-ids.util';

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
  entityId: string,
): string => {
  const fromChanges = firstString(changes['title'], changes['name']);
  if (fromChanges) {
    return fromChanges;
  }
  for (const op of ops) {
    const entity = extractEntityFromPayload(op.payload, payloadKey, entityId) as
      | Record<string, unknown>
      | undefined;
    const isMultiEntityOp = isMultiEntityOperation(op);
    if (!isMultiEntityOp || entity?.['id'] === entityId) {
      const title = firstString(entity?.['title'], entity?.['name']);
      if (title) {
        return title;
      }
    }
    // A multi-entity action's generic payload is not attributable to one target
    // entity. Only use its target-scoped `changes`/entity payload above.
    if (isMultiEntityOp) continue;
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
 * `kind: 'action'` diffs for every opaque op on either side: the op's mutation
 * is real but not readable as field values (see `extractOpChanges`), so the
 * raw action payload is preserved verbatim under the action type instead. This
 * keeps the discarded change REVIEWABLE (the journal entry outlives the op),
 * while `loserChangesFor`/`winnerChangesFor` skip these diffs so flip and the
 * stale guard never treat an action payload as entity fields.
 */
const buildOpaqueActionDiffs = (
  localOps: Operation[],
  remoteOps: Operation[],
  payloadKey: string,
  entityId: string,
  pickedSide: 'local' | 'remote',
): ConflictJournalFieldDiff[] => {
  const byActionType = new Map<string, ConflictJournalFieldDiff>();
  const add = (op: Operation, side: 'local' | 'remote'): void => {
    if (!isOpaqueChangeOp(op, payloadKey, entityId)) {
      return;
    }
    const diff = byActionType.get(op.actionType) ?? {
      field: op.actionType,
      localVal: undefined,
      remoteVal: undefined,
      localChanged: false,
      remoteChanged: false,
      pickedSide,
      kind: 'action' as const,
    };
    if (side === 'local') {
      diff.localVal = extractActionPayload(op.payload);
      diff.localChanged = true;
    } else {
      diff.remoteVal = extractActionPayload(op.payload);
      diff.remoteChanged = true;
    }
    byActionType.set(op.actionType, diff);
  };
  for (const op of localOps) {
    add(op, 'local');
  }
  for (const op of remoteOps) {
    add(op, 'remote');
  }
  return Array.from(byActionType.values());
};

/**
 * Classifies one already-resolved LWW conflict into a journal entry.
 *
 * Precedence: clock-corruption → delete-wins → delete-lost → noise → newer/tie.
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
  const localChanges = mergeChangedFields(localOps, payloadKey, entityId);
  const remoteChanges = mergeChangedFields(remoteOps, payloadKey, entityId);

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
      extractEntityTitle(localOps, localChanges, payloadKey, entityId) ||
      extractEntityTitle(remoteOps, remoteChanges, payloadKey, entityId);
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
  // value VERBATIM so the loser's discarded values are preserved, plus per-side
  // presence flags so readers can tell "this side never touched the field"
  // apart from the union's `undefined` placeholder.
  const fieldNames = Array.from(
    new Set([...Object.keys(localChanges), ...Object.keys(remoteChanges)]),
  );
  const fieldDiffs: ConflictJournalFieldDiff[] = fieldNames.map((field) => ({
    field,
    localVal: localChanges[field],
    remoteVal: remoteChanges[field],
    localChanged: field in localChanges,
    remoteChanged: field in remoteChanges,
    pickedSide: winner,
  }));
  fieldDiffs.push(
    ...buildOpaqueActionDiffs(localOps, remoteOps, payloadKey, entityId, winner),
  );

  const winnerOps = winner === 'local' ? localOps : remoteOps;
  const loserOps = winner === 'local' ? remoteOps : localOps;
  const loserChanges = winner === 'local' ? remoteChanges : localChanges;
  const loserRealFields = Object.keys(loserChanges).filter(
    (field) => !NOISE_FIELDS.has(field),
  );
  // Opaque loser ops (mutation not readable as fields — e.g. convertToSubTask)
  // are REAL losses: without this, `loserChanges` is empty and the discarded
  // structural change would be misclassified as `noise`/`info` and hidden.
  const loserHasOpaqueChanges = hasOpaqueChanges(loserOps, payloadKey, entityId);

  const isDeleteWin =
    ARCHIVE_PLAN_REASONS.has(planReason) ||
    winnerOps.some((op) => op.opType === OpType.Delete);

  // Inverse of delete-wins: the LOSER side is a pure DELETE — a delete that lost
  // to a concurrent newer edit, so LWW resurrected the entity and the user's
  // delete was silently overridden. Because a DELETE op carries no field changes,
  // `loserChanges` is empty, which would otherwise misclassify this as `noise`.
  // Must be checked BEFORE the noise fallthrough. (delete-wins takes precedence
  // when the winner is also a delete, e.g. delete-vs-delete.)
  const isDeleteLost = loserOps.some((op) => op.opType === OpType.Delete);

  let reason: ConflictJournalReason;
  let status: ConflictJournalStatus;
  if (isCorruptionSuspected) {
    reason = 'clock-corruption-suspected';
    status = 'unreviewed';
  } else if (isDeleteWin) {
    reason = 'delete-wins';
    status = 'unreviewed';
  } else if (isDeleteLost) {
    reason = 'delete-lost';
    status = 'unreviewed';
  } else if (loserRealFields.length === 0 && !loserHasOpaqueChanges) {
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
      entityId,
    ) ||
    extractEntityTitle(
      winner === 'local' ? remoteOps : localOps,
      loserChanges,
      payloadKey,
      entityId,
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
