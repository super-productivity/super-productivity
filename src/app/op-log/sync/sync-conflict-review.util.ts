/**
 * SPAP-15 — Pure presentation/derivation helpers for the Sync Conflicts review
 * UI. No Angular / NgRx / IndexedDB dependencies so these are trivially unit
 * testable and can be reused by the page component, the flip service and the
 * banner service.
 */

import { EntityType } from '../core/operation.types';
import { T } from '../../t.const';
import {
  ConflictJournalEntry,
  ConflictJournalFieldDiff,
  ConflictJournalReason,
  ConflictJournalStatus,
  ConflictJournalWinner,
} from './conflict-journal.model';

const CR = T.F.SYNC.CONFLICT_REVIEW;

export interface ConflictWinCounts {
  total: number;
  /** Entries where the remote side won (a local edit was discarded). */
  remoteWins: number;
  /** Entries where the local side won (a remote edit was discarded). */
  localWins: number;
}

/**
 * Counts how the given entries resolved. Only `local`/`remote` winners are
 * tallied into the breakdown; `merged` entries have no losing side and are
 * excluded from both win buckets (but still counted in `total`).
 */
export const computeWinCounts = (
  entries: readonly ConflictJournalEntry[],
): ConflictWinCounts => {
  let remoteWins = 0;
  let localWins = 0;
  for (const e of entries) {
    if (e.winner === 'remote') {
      remoteWins++;
    } else if (e.winner === 'local') {
      localWins++;
    }
  }
  return { total: entries.length, remoteWins, localWins };
};

/**
 * Whether the given side actually changed the diffed field. Falls back to
 * value-presence for entries persisted before the `localChanged`/`remoteChanged`
 * flags existed — exact for that data, since op payloads are pure JSON and can
 * never carry a real `undefined`.
 */
const sideChanged = (
  diff: ConflictJournalFieldDiff,
  side: 'local' | 'remote',
): boolean =>
  side === 'local'
    ? (diff.localChanged ?? diff.localVal !== undefined)
    : (diff.remoteChanged ?? diff.remoteVal !== undefined);

/**
 * For each diffed field, the value of the side that LWW *discarded* (the loser).
 * Applying this map re-instates the losing edit — this is exactly what "flip"
 * dispatches. Skipped: `merged` entries as a whole (nothing was discarded — and
 * their noise-tiebreak diffs DO carry a `pickedSide`, so the per-diff check
 * alone would not exclude them), `kind: 'action'` diffs, and fields the losing
 * side never changed (a union diff records those as `undefined`, and
 * dispatching them would CLEAR winner-only fields instead of layering the
 * discarded edit on top).
 */
export const loserChangesFor = (entry: ConflictJournalEntry): Record<string, unknown> => {
  const changes: Record<string, unknown> = {};
  if (entry.winner === 'merged') {
    return changes;
  }
  for (const diff of entry.fieldDiffs) {
    if (diff.kind === 'action') {
      // Raw action payload of an opaque op — not an entity field.
      continue;
    }
    if (diff.pickedSide === 'local' && sideChanged(diff, 'remote')) {
      changes[diff.field] = diff.remoteVal;
    } else if (diff.pickedSide === 'remote' && sideChanged(diff, 'local')) {
      changes[diff.field] = diff.localVal;
    }
  }
  return changes;
};

/**
 * For each diffed field the winner actually changed, the value LWW *kept*.
 * The stale-flip guard compares the entity's CURRENT field values to these: if
 * any differ, the entity was edited since the conflict resolved and flipping
 * would overwrite that newer edit. Loser-only fields are omitted — the winner
 * recorded no value for them, and comparing `undefined` against the live entity
 * would flag every such entry stale.
 */
export const winnerChangesFor = (
  entry: ConflictJournalEntry,
): Record<string, unknown> => {
  const changes: Record<string, unknown> = {};
  // Merged entries have no winner/loser side — see loserChangesFor.
  if (entry.winner === 'merged') {
    return changes;
  }
  for (const diff of entry.fieldDiffs) {
    if (diff.kind === 'action') {
      // Raw action payload of an opaque op — not an entity field.
      continue;
    }
    if (diff.pickedSide === 'local' && sideChanged(diff, 'local')) {
      changes[diff.field] = diff.localVal;
    } else if (diff.pickedSide === 'remote' && sideChanged(diff, 'remote')) {
      changes[diff.field] = diff.remoteVal;
    }
  }
  return changes;
};

/** Which side supplied a given field's value in a merged entry. */
export const mergedFieldSideKey = (diff: ConflictJournalFieldDiff): string =>
  diff.pickedSide === 'remote' ? CR.SIDE_REMOTE : CR.SIDE_LOCAL;

// Kebab-case reason values can't be object-literal keys (lint naming rule), so
// a Map keeps the mapping explicit and typed.
const REASON_KEYS: ReadonlyMap<ConflictJournalReason, string> = new Map([
  ['newer', CR.REASON_NEWER],
  ['tie', CR.REASON_TIE],
  ['delete-wins', CR.REASON_DELETE_WINS],
  ['delete-lost', CR.REASON_DELETE_LOST],
  ['disjoint-merge', CR.REASON_DISJOINT_MERGE],
  ['noise', CR.REASON_NOISE],
  ['clock-corruption-suspected', CR.REASON_CLOCK_CORRUPTION],
]);

export const reasonI18nKey = (reason: ConflictJournalReason): string =>
  REASON_KEYS.get(reason) ?? reason;

const WINNER_KEYS: Record<ConflictJournalWinner, string> = {
  local: CR.WINNER_LOCAL,
  remote: CR.WINNER_REMOTE,
  merged: CR.WINNER_MERGED,
};

export const winnerI18nKey = (winner: ConflictJournalWinner): string =>
  WINNER_KEYS[winner] ?? winner;

const STATUS_KEYS: Record<ConflictJournalStatus, string> = {
  unreviewed: CR.STATUS_UNREVIEWED,
  kept: CR.STATUS_KEPT,
  flipped: CR.STATUS_FLIPPED,
  info: CR.STATUS_INFO,
  expired: CR.STATUS_INFO,
};

export const statusI18nKey = (status: ConflictJournalStatus): string =>
  STATUS_KEYS[status] ?? status;

const GROUP_KEYS: Partial<Record<EntityType, string>> = {
  TASK: CR.GROUP_TASK,
  PROJECT: CR.GROUP_PROJECT,
  TAG: CR.GROUP_TAG,
  NOTE: CR.GROUP_NOTE,
};

export const groupLabelKey = (entityType: EntityType): string =>
  GROUP_KEYS[entityType] ?? CR.GROUP_OTHER;

/** Short, opaque device label — no friendly-name mechanism exists in the app. */
export const shortClientId = (clientId: string): string =>
  clientId ? clientId.slice(0, 8) : '?';

/** A group of entries that share one entity type, for grouped rendering. */
export interface ConflictEntryGroup {
  entityType: EntityType;
  labelKey: string;
  entries: ConflictJournalEntry[];
}

/**
 * Groups entries by entity type, preserving the incoming (newest-first) order
 * both across and within groups. Group order follows first appearance.
 */
export const groupByEntityType = (
  entries: readonly ConflictJournalEntry[],
): ConflictEntryGroup[] => {
  const byType = new Map<EntityType, ConflictJournalEntry[]>();
  for (const e of entries) {
    const list = byType.get(e.entityType);
    if (list) {
      list.push(e);
    } else {
      byType.set(e.entityType, [e]);
    }
  }
  return Array.from(byType, ([entityType, groupEntries]) => ({
    entityType,
    labelKey: groupLabelKey(entityType),
    entries: groupEntries,
  }));
};
