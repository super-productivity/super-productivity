/**
 * SPAP-13 — Conflict Journal data model (SPAP-12 schema).
 *
 * A device-local record of every sync-conflict auto-resolution, so a losing
 * edit is preserved and reviewable later. Purely observational: writing a
 * journal entry never influences which operation LWW conflict resolution picks.
 *
 * Journal entries are DEVICE-LOCAL and MUST NEVER be synced — they capture the
 * discarded (losing) side of a conflict verbatim, which is exactly the data the
 * op-log intentionally dropped. See `conflict-journal.service.ts`.
 */

import { EntityType } from '../core/operation.types';

/**
 * Which side of the conflict LWW kept.
 * - `local` / `remote`: whole-entity LWW winner (SPAP-13).
 * - `merged`: disjoint-field auto-merge (SPAP-14 — reserved, not emitted here).
 */
export type ConflictJournalWinner = 'local' | 'remote' | 'merged';

/**
 * Why the conflict resolved the way it did (SPAP-12 taxonomy).
 * - `newer`: both edited the same real field, newer timestamp won.
 * - `tie`: both edited the same real field, timestamps equal → remote won.
 * - `delete-wins`: an edit lost to a delete/archive of the same entity.
 * - `delete-lost`: the inverse — a delete lost to a concurrent newer edit, so the
 *   entity was resurrected and the user's delete was silently overridden. The
 *   loser side is a pure DELETE op (no field changes), so without this reason it
 *   would fall through to `noise`/`info` and never surface for review.
 * - `disjoint-merge`: disjoint-field auto-merge (SPAP-14 — reserved, NOT emitted
 *   by SPAP-13; the value exists so downstream code can already switch on it).
 * - `noise`: the discarded side only touched NOISE_FIELDS (no real content lost).
 * - `clock-corruption-suspected`: the conflict only arose because per-entity
 *   clock corruption forced a CONCURRENT comparison (see `_adjustForClockCorruption`).
 */
export type ConflictJournalReason =
  | 'newer'
  | 'tie'
  | 'delete-wins'
  | 'delete-lost'
  | 'disjoint-merge'
  | 'noise'
  | 'clock-corruption-suspected';

/**
 * Review lifecycle of an entry.
 * - `unreviewed`: a real edit was discarded; awaiting user review.
 * - `kept`: user confirmed the auto-resolution.
 * - `flipped`: user chose the discarded side instead (SPAP-15+ applies it).
 * - `info`: informational only (e.g. `noise`) — no real data lost.
 * - `expired`: retention window elapsed (reserved).
 */
export type ConflictJournalStatus =
  | 'unreviewed'
  | 'kept'
  | 'flipped'
  | 'info'
  | 'expired';

/**
 * One field-level diff between the two conflicting sides. Stores only the field
 * values (not whole entities). `localVal`/`remoteVal` are captured VERBATIM from
 * the respective op payloads so the loser's discarded values are preserved.
 */
export interface ConflictJournalFieldDiff {
  field: string;
  localVal: unknown;
  remoteVal: unknown;
  /**
   * Whether each side's ops actually changed this field. Distinguishes "this
   * side never touched the field" from "this side set it to a value" — without
   * the flags a union diff stores the untouched side as `undefined`, and a flip
   * would then dispatch `{ field: undefined }`, clearing a winner-only field.
   * Optional because entries persisted before the flags existed lack them;
   * readers fall back to value-presence (`val !== undefined`), which is exact
   * for legacy data since op payloads are pure JSON and cannot encode a real
   * `undefined`.
   */
  localChanged?: boolean;
  remoteChanged?: boolean;
  /** Which side's value LWW kept for this field. Absent for `merged`. */
  pickedSide?: 'local' | 'remote';
  /**
   * `action`: not an entity field — `field` is the ACTION TYPE and the side
   * values are the raw action payload of a non-adapter op whose field-level
   * delta could not be extracted (e.g. `convertToSubTask`'s
   * `{ taskId, targetParentId, afterTaskId }`). Preserved verbatim so the
   * discarded change stays reviewable; excluded from flip / stale-guard
   * computations, which only operate on real entity fields. Absent = `field`.
   */
  kind?: 'action';
}

/**
 * A single conflict-journal record (SPAP-12 data model). Device-local, never synced.
 */
export interface ConflictJournalEntry {
  id: string;
  entityType: EntityType;
  entityId: string;
  entityTitle: string;
  resolvedAt: number;
  winner: ConflictJournalWinner;
  reason: ConflictJournalReason;
  fieldDiffs: ConflictJournalFieldDiff[];
  localClientId: string;
  remoteClientId: string;
  localTs: number;
  remoteTs: number;
  status: ConflictJournalStatus;
}

/** The two views the service can list. */
export type ConflictJournalView = 'unreviewed' | 'history';

// ─────────────────────────────────────────────────────────────────────────────
// Retention (pruned on app-start; whichever bound binds first)
// ─────────────────────────────────────────────────────────────────────────────

/** Entries older than this many days are pruned on start. */
export const JOURNAL_RETENTION_DAYS = 14;

/** At most this many entries are kept (newest wins) — pruned on start. */
export const JOURNAL_MAX_ENTRIES = 200;

// ─────────────────────────────────────────────────────────────────────────────
// NOISE_FIELDS
//
// Fields whose divergence is NOT a real user content edit: last-modified /
// metadata timestamps. When the discarded (losing) side of a conflict changed
// ONLY these fields, no real content was lost, so the entry is journaled as
// `noise`/`info` rather than a content loss.
//
// NOTE (SPAP-13): the list-ordering arrays (`taskIds`, `subTaskIds`,
// `backlogTaskIds`, `noteIds`) are DELIBERATELY NOT noise. They carry
// MEMBERSHIP as well as order — a task added/removed on one device rewrites the
// parent's `taskIds`, and blanket-classifying that as noise would silently hide
// a membership loss (the added item dropped by LWW) as `info`. Erring toward
// surfacing, an overlap on these fields is journaled as a reviewable conflict.
// A future, set-aware refinement (noise only when membership is unchanged and
// just the order differs) can revisit this — see SPAP-14.
// Timestamp field is `modified` on TASK (task.model.ts); `lastModified` /
// `created` are included defensively as conventional metadata names.
// ─────────────────────────────────────────────────────────────────────────────

export const NOISE_FIELDS: ReadonlySet<string> = new Set<string>([
  'modified',
  'lastModified',
  'created',
]);

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB store identity
//
// A NEW, standalone database — completely separate from the op-log `SUP_OPS`
// DB so the journal cannot affect op-log schema/versioning or risk its data.
// ─────────────────────────────────────────────────────────────────────────────

export const CONFLICT_JOURNAL_DB_NAME = 'SUP_CONFLICT_JOURNAL';
export const CONFLICT_JOURNAL_DB_VERSION = 1;
export const CONFLICT_JOURNAL_STORE = 'conflicts';
export const CONFLICT_JOURNAL_INDEX_STATUS = 'by-status';
export const CONFLICT_JOURNAL_INDEX_RESOLVED_AT = 'by-resolvedAt';
