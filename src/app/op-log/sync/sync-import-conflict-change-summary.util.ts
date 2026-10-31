import {
  extractActionPayload,
  isFullStateOpType,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';

/**
 * The conflict dialog only lists individual local changes up to this count;
 * beyond it a list is noise and the user falls back to the plain count.
 */
export const MAX_LISTED_LOCAL_CHANGES = 20;

/** Fields shown per changed entity before the list is cut off. */
const MAX_LISTED_FIELDS = 4;

/** Bookkeeping fields no user ever edited by hand. */
const IGNORED_FIELDS: ReadonlySet<string> = new Set(['id', 'modified']);

export type SyncImportConflictChangeKind =
  | 'CREATED'
  | 'UPDATED'
  | 'DELETED'
  | 'IMPORTED'
  | 'OTHER';

/**
 * One entity this device changed locally that an incoming full-state replace
 * would discard. Deliberately holds no payload: it is rendered as-is and must
 * stay small enough to hand to a dialog.
 */
export interface SyncImportConflictChange {
  entityType: string;
  entityId?: string;
  kind: SyncImportConflictChangeKind;
  /** Title/name of the entity, when an op payload or the live state carries one. */
  label?: string;
  /** Fields the local edits touched (UPDATED only), capped at MAX_LISTED_FIELDS. */
  fields?: string[];
}

interface Accumulator {
  entityType: string;
  entityId?: string;
  hasFullState: boolean;
  hasCreate: boolean;
  hasDelete: boolean;
  hasUpdate: boolean;
  label?: string;
  fields: Set<string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

/**
 * Pulls a human label (task/note/project `title`, tag/project `name`) out of an
 * action payload. Entity payloads sit under varying keys (`task`, `project`, …)
 * and updates wrap the edited fields in `changes`, so scan the object-valued
 * entries rather than hard-coding one key per action.
 */
const readLabel = (actionPayload: Record<string, unknown>): string | undefined => {
  for (const value of Object.values(actionPayload)) {
    if (!isRecord(value)) {
      continue;
    }
    const source = isRecord(value['changes']) ? value['changes'] : value;
    const label = nonEmptyString(source['title']) ?? nonEmptyString(source['name']);
    if (label) {
      return label;
    }
  }
  return undefined;
};

const readChangedFields = (actionPayload: Record<string, unknown>): string[] => {
  for (const value of Object.values(actionPayload)) {
    if (isRecord(value) && isRecord(value['changes'])) {
      return Object.keys(value['changes']).filter((key) => !IGNORED_FIELDS.has(key));
    }
  }
  return [];
};

const toKind = (acc: Accumulator): SyncImportConflictChangeKind => {
  if (acc.hasFullState) {
    return 'IMPORTED';
  }
  if (acc.hasDelete) {
    return 'DELETED';
  }
  if (acc.hasCreate) {
    return 'CREATED';
  }
  return acc.hasUpdate ? 'UPDATED' : 'OTHER';
};

export interface SyncImportConflictChangeSummary {
  changes: SyncImportConflictChange[];
  /** Pending ops the app wrote itself (see AUTOMATIC_UPDATE_FIELDS), not listed in `changes`. */
  automaticOpCount: number;
}

/**
 * Updates the app writes on its own while the user does nothing: creating the
 * day's instance of a repeating task stamps these fields on the repeat config.
 * Listing them as "edited" would bury the user's real changes, so they are
 * counted separately instead.
 */
const AUTOMATIC_UPDATE_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  TASK_REPEAT_CFG: new Set(['lastTaskCreation', 'lastTaskCreationDay']),
};

const isAutomaticUpdate = (entityType: string, fields: string[]): boolean => {
  const automatic = AUTOMATIC_UPDATE_FIELDS[entityType];
  return !!automatic && fields.length > 0 && fields.every((f) => automatic.has(f));
};

/**
 * Collapses pending local ops into one row per touched entity, in the order
 * each entity was first touched. Returns `undefined` when there are more ops
 * than the dialog should list, so callers can't render an unreadable wall.
 *
 * Pure and read-only: the ops stay exactly as they are in the log.
 */
export const summarizePendingOps = (
  entries: OperationLogEntry[],
): SyncImportConflictChangeSummary | undefined => {
  if (entries.length === 0 || entries.length > MAX_LISTED_LOCAL_CHANGES) {
    return undefined;
  }

  const byEntity = new Map<string, Accumulator>();
  let automaticOpCount = 0;

  for (const { op } of entries) {
    const ids = op.entityIds?.length ? op.entityIds : [op.entityId];
    const actionPayload = isRecord(op.payload) ? extractActionPayload(op.payload) : {};
    if (
      op.opType === OpType.Update &&
      ids.length === 1 &&
      isAutomaticUpdate(op.entityType, readChangedFields(actionPayload))
    ) {
      automaticOpCount++;
      continue;
    }
    // A multi-id op shares one payload, so a label read from it would be
    // attributed to every id — only trust it for single-entity ops.
    const label = ids.length === 1 ? readLabel(actionPayload) : undefined;
    const fields = ids.length === 1 ? readChangedFields(actionPayload) : [];

    for (const entityId of ids) {
      const key = `${op.entityType}:${entityId ?? '*'}`;
      const acc = byEntity.get(key) ?? {
        entityType: op.entityType,
        entityId,
        hasFullState: false,
        hasCreate: false,
        hasDelete: false,
        hasUpdate: false,
        fields: new Set<string>(),
      };
      acc.hasFullState ||= isFullStateOpType(op.opType);
      acc.hasCreate ||= op.opType === OpType.Create;
      acc.hasDelete ||= op.opType === OpType.Delete;
      acc.hasUpdate ||= op.opType === OpType.Update;
      // Latest op wins, so a rename shows the newest title.
      acc.label = label ?? acc.label;
      if (op.opType === OpType.Update) {
        fields.forEach((field) => acc.fields.add(field));
      }
      byEntity.set(key, acc);
    }
  }

  const changes = [...byEntity.values()].map((acc) => {
    const kind = toKind(acc);
    const fields = [...acc.fields].slice(0, MAX_LISTED_FIELDS);
    return {
      entityType: acc.entityType,
      ...(acc.entityId !== undefined ? { entityId: acc.entityId } : {}),
      kind,
      ...(acc.label !== undefined ? { label: acc.label } : {}),
      ...(kind === 'UPDATED' && fields.length ? { fields } : {}),
    };
  });
  return { changes, automaticOpCount };
};
