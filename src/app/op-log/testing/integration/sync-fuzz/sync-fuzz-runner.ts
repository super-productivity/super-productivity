import { TestBed } from '@angular/core/testing';
import { ArchiveDbAdapter } from '../../../../core/persistence/archive-db-adapter.service';
import { Note } from '../../../../features/note/note.model';
import { Project } from '../../../../features/project/project.model';
import { SimpleCounter } from '../../../../features/simple-counter/simple-counter.model';
import { Task } from '../../../../features/tasks/task.model';
import { classifyOpAgainstSyncImport } from '@sp/sync-core';
import { compareVectorClocks } from '../../../../core/util/vector-clock';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FULL_STATE_OP_TYPES, VectorClock } from '../../../core/operation.types';
import {
  AppStateSnapshot,
  StateSnapshotService,
} from '../../../backup/state-snapshot.service';
import { ValidateStateService } from '../../../validation/validate-state.service';
import { OperationLogStoreService } from '../../../persistence/operation-log-store.service';
import {
  executeIntent,
  FuzzStep,
  FuzzWrite,
  fuzzDay,
  generateIntent,
  Intent,
  IntentWeights,
  isUiPossible,
  REPLACEMENT_INTENTS,
  SETUP_INTENTS,
  viewOf,
} from './sync-fuzz-actions';
import {
  FuzzDevice,
  FuzzEvent,
  FuzzEventKind,
  ImportDialogAnswer,
  SyncFuzzHarness,
} from './sync-fuzz-harness';

/**
 * Runs one trace (generated from a seed, or replayed from a fixture) and
 * checks the oracles. A failure's `signature` classifies it without step
 * numbers or ids, so shrinking can require "the same failure".
 */

export interface FuzzFailure {
  signature: string;
  detail: string;
}

export interface FuzzResult {
  steps: FuzzStep[];
  failures: FuzzFailure[];
  /** Distinct server rejections, as `<errorCode> <actionType>`. */
  rejections: string[];
  ms: number;
  /** With `debug`: server rows, rejections and every device's op log. */
  dump?: string[];
}

export interface FuzzOptions {
  seed?: number;
  steps?: FuzzStep[];
  stepCount?: number;
  /**
   * Intent mix for generated traces (default DEFAULT_WEIGHTS). A mix with a
   * state replacement also answers the SYNC_IMPORT conflict dialog on every
   * step (`k`). Every mix answers the whole-dataset dialog after a stop; see
   * runFuzz's `modelsStopDialog`.
   */
  weights?: IntentWeights;
  debug?: boolean;
}

const DEVICES = ['A', 'B', 'C'];
const SYNC_PROBABILITY = 0.35;
const COMPACT_PROBABILITY = 0.1;
const RESTART_PROBABILITY = 0.1;
const SETTLE_ROUNDS = 6;
/** How often a generated step keeps local data in a dialog (`k`). */
const USE_LOCAL_PROBABILITY = 0.3;
/**
 * Seeds the `k` stream of mixes without a replacement intent: drawing `k`
 * from the main stream would change every trace of those mixes, stop or not.
 */
const DIALOG_STREAM_SALT = 0x5f0d1a10;
/**
 * Full-state ops that only a user's replacement intent creates: the force
 * upload (also the dialog's USE_LOCAL) and the backup import.
 */
const USER_REPLACEMENT_REASONS: Readonly<Record<string, string>> = {
  SYNC_IMPORT: 'FORCE_UPLOAD',
  BACKUP_IMPORT: 'BACKUP_RESTORE',
};
const FAILING_EVENTS: readonly FuzzEventKind[] = [
  'stop',
  'sync-error',
  'sync-halted',
  'full-state',
  'validation',
  'permanent-rejection',
  'dialog',
  'error-snack',
  'dev-error',
];

/** mulberry32, as in replacement-convergence.integration.spec.ts. */
export const createRandom = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** One executed intent, with the acting device's vector clock after it. */
export interface LedgerEntry {
  intent: Intent;
  writes: FuzzWrite[];
  device: string;
  clientId: string;
  clock: VectorClock;
  /** The device's own counter before the intent: its ops are above it. */
  counterBefore: number;
  /**
   * The latest timestamp of the intent's own ops: its edit time, which LWW
   * compares (with the clientId on a tie).
   */
  time: number;
  /**
   * The runner's sync count after which its device first synced, so its ops
   * uploaded (Infinity: never). Intents of one device with the same value
   * were pending together: one side of a conflict. A sync that stopped or
   * halted stamps it too, though its ops may stay pending; such a run already
   * fails for the stop.
   */
  uploadedAt: number;
  /** One of its ops is opaque to the field patch (`planTasksForToday`). */
  opaque: boolean;
  /** One of its ops was still unsynced when its device answered USE_REMOTE. */
  discarded?: boolean;
}

/** A value an intent wrote, with the intent that wrote it. */
interface LedgerWrite {
  value: unknown;
  entry: LedgerEntry;
}

/**
 * Intents whose ops always take a whole-entity conflict path, so a crossing
 * with one can carry any value its winning side held. Each mirrors a refusal
 * in production:
 * - `countHabit`: an opaque op (decision 6 of
 *   docs/sync-and-op-log/lww-field-level-resolution.md): `sideNonNoiseKeys`
 *   returns undefined for it, so `isFieldPatchEligible` refuses;
 * - `deleteTask`: a DELETE refuses in `isFieldPatchEligible`, and its plan is
 *   a whole-entity win (`ConflictResolutionService._isWholeEntityWinPlan`);
 * - `archiveTask`: no `{ id, changes }` to read (`isOpaqueChangeOp`), and a
 *   multi-entity op with subtasks; an archive also wins over a concurrent
 *   edit by sync-core's planner (`_isWholeEntityWinPlan`);
 * - `restoreTask`: carries the flat archived task, not `{ id, changes }`, so a
 *   local one refuses (`isChangesShapedOp` in `isFieldPatchEligible`). A
 *   remote one is read per field but writes every field at its own time, as
 *   a snapshot does; the side rule here differs only where the other side
 *   has a later intent than the restore (kept as before, not seen in fuzz).
 * A `track` is whole-entity when it plans the task for today (`opaque`,
 * decision 6). A plain delta is not: detection drops a remote one that is
 * disjoint from the local side before it reaches a conflict
 * (`isCommutingTimeDeltaCrossing` in
 * `ConflictResolutionService._checkEntityForConflict`'s CONCURRENT branch),
 * and a local one stays pending beside the patch (`keptLocalTimeDeltas`).
 */
const WHOLE_ENTITY_INTENTS: ReadonlySet<Intent[0]> = new Set([
  'countHabit',
  'deleteTask',
  'archiveTask',
  'restoreTask',
]);

/** The losses a recreate with defaults explains (see checkPreservation). */
const RECREATE_LOSS = /^(field-reverted|field-unwritten|time-loss|import-field-changed):/;

/** Action types the field patch cannot read (decision 6). */
export const OPAQUE_ACTION_TYPES: ReadonlySet<string> = new Set([
  TaskSharedActions.planTasksForToday.type,
]);

/** The latest of a side's intents: the side's LWW key. */
const latestOf = (side: readonly LedgerEntry[]): LedgerEntry =>
  side.reduce((latest, e) => (isLaterWrite(e, latest) ? e : latest));

const entityOfIntent = (intent: Intent): string => {
  const [kind, id] = intent;
  const type = /Task|^track$/.test(kind) ? 'task' : /Note$/.test(kind) ? 'note' : 'habit';
  return `${type}:${id}`;
};

const isConcurrent = (a: LedgerEntry, b: LedgerEntry): boolean =>
  compareVectorClocks(a.clock, b.clock) === 'CONCURRENT';

/** Whether `b`'s device had seen `a` (or `a` is `b`) when it wrote `b`. */
const isCausalPastOf = (a: LedgerEntry, b: LedgerEntry): boolean => {
  const comparison = compareVectorClocks(a.clock, b.clock);
  return comparison === 'LESS_THAN' || comparison === 'EQUAL';
};

/**
 * Whether `a` wins LWW over `b`: the later timestamp, then the larger
 * clientId (planLwwConflictResolutions in packages/sync-core).
 */
const isLaterWrite = (
  a: Pick<LedgerEntry, 'time' | 'clientId'>,
  b: Pick<LedgerEntry, 'time' | 'clientId'>,
): boolean => a.time > b.time || (a.time === b.time && a.clientId > b.clientId);

/** What the executed intents imply, for the preservation oracles. */
export class Ledger {
  readonly created = new Set<string>();
  readonly deleted = new Set<string>();
  /** Per entity, the intents that targeted it, in execution order. */
  readonly byEntity = new Map<string, LedgerEntry[]>();
  readonly writes = new Map<string, LedgerWrite[]>();

  constructor(entries: readonly LedgerEntry[]) {
    for (const entry of entries) this._note(entry);
  }

  private _note(entry: LedgerEntry): void {
    const { intent, writes } = entry;
    const [kind] = intent;
    if (REPLACEMENT_INTENTS.has(kind) || kind.startsWith('reorder')) return;
    const entity = entityOfIntent(intent);
    if (kind.startsWith('add')) this.created.add(entity);
    if (kind.startsWith('delete')) this.deleted.add(entity);
    this.byEntity.set(entity, [...(this.byEntity.get(entity) ?? []), entry]);
    for (const write of writes) {
      const key = `${write.entity}|${write.field}`;
      this.writes.set(key, [
        ...(this.writes.get(key) ?? []),
        { value: write.value, entry },
      ]);
    }
  }

  /**
   * Whether `entry` crosses an archive of its entity: the archive wins over a
   * concurrent edit by design (sync-core's planner), so what the edit wrote
   * or tracked is not expected to survive.
   */
  crossesArchive(entity: string, entry: LedgerEntry): boolean {
    return (this.byEntity.get(entity) ?? []).some(
      (other) => other.intent[0] === 'archiveTask' && isConcurrent(other, entry),
    );
  }

  /** Whether some intent on the entity is concurrent with one of its deletes. */
  deleteWasCrossed(entity: string): boolean {
    const entries = this.byEntity.get(entity) ?? [];
    return entries.some(
      (del) =>
        del.intent[0].startsWith('delete') && entries.some((e) => isConcurrent(e, del)),
    );
  }

  /** The time tracked on the entity, without what crossed an archive. */
  trackedTime(entity: string): number | undefined {
    const tracks = (this.byEntity.get(entity) ?? []).filter(
      (entry) => entry.intent[0] === 'track',
    );
    if (tracks.length === 0) return undefined;
    return tracks
      .filter((entry) => !this.crossesArchive(entity, entry))
      .reduce((sum, entry) => sum + (entry.intent[2] as number), 0);
  }

  /**
   * The two sides of the conflict in which `a` and `b`, concurrent intents
   * on `entity` from two devices, meet, as SuperSync resolves it: the device
   * that uploads later resolves, with the intents it had pending together
   * (one upload) against the other device's intents it has not seen and that
   * were uploaded before. `whole` says the conflict takes a whole-entity
   * path: an opaque or whole-entity intent on either side
   * (`WHOLE_ENTITY_INTENTS`). Otherwise both sides are readable and the
   * conflict resolves per field.
   *
   * Where this model and production can differ:
   * - it takes one other device at a time; the app's remote side is everything
   *   it downloads for the entity, so a third device's opaque op in the same
   *   download makes production resolve whole-entity where this says per
   *   field (a false `older-write-won`, never a missed one);
   * - LWW rows are not intents, so a remote `'replace'` row (a stale local-win
   *   snapshot, #10421) and a pending local row (whole-entity) are not seen;
   * - only the later uploader resolves, as on SuperSync; on a file-based
   *   provider both devices can.
   */
  crossing(
    entity: string,
    a: LedgerEntry,
    b: LedgerEntry,
  ): { aSide: LedgerEntry[]; bSide: LedgerEntry[]; whole: boolean } {
    const entries = this.byEntity.get(entity) ?? [];
    const [resolver, other] = a.uploadedAt >= b.uploadedAt ? [a, b] : [b, a];
    const local = entries.filter(
      (e) => e.device === resolver.device && e.uploadedAt === resolver.uploadedAt,
    );
    const remote = entries.filter(
      (e) =>
        e.device === other.device &&
        e.uploadedAt < resolver.uploadedAt &&
        isConcurrent(e, resolver),
    );
    const isWholeEntity = (e: LedgerEntry): boolean =>
      WHOLE_ENTITY_INTENTS.has(e.intent[0]) || e.opaque;
    const whole = [...local, ...remote].some(isWholeEntity);
    return resolver === a
      ? { aSide: local, bSide: remote, whole }
      : { aSide: remote, bSide: local, whole };
  }
}

/**
 * What the last state replacement on the server (a SYNC_IMPORT or
 * BACKUP_IMPORT) legitimately discards. Every device drops the ops that are
 * not causally after it (CONCURRENT or LESS_THAN by vector clock), by design
 * (AGENTS.md sync rule 7). So the preservation oracles check only the intents
 * whose device clock is at or after the replacement's, on top of the
 * replacement's own content: its entities and tracked time.
 */
export interface Replacement {
  clock: VectorClock;
  /** The client that created it. */
  clientId: string;
  entities: Set<string>;
  time: Map<string, number>;
  /**
   * The replacement's value of every field an intent can write, by
   * `<entity>|<field>` as in the ledger.
   */
  fields: Map<string, unknown>;
}

/** The fields the intents write (FuzzWrite), per entity type. */
const WRITTEN_FIELDS: Readonly<Record<string, readonly string[]>> = {
  task: ['title', 'notes', 'isDone'],
  note: ['content', 'isPinnedToToday', 'isLock'],
  habit: ['title', 'isEnabled'],
};

const lastReplacement = (harness: SyncFuzzHarness): Replacement | undefined => {
  const row = [...harness.server.rows]
    .reverse()
    .find((r) => r.op.opType === 'SYNC_IMPORT' || r.op.opType === 'BACKUP_IMPORT');
  if (!row) return undefined;
  const state = row.op.payload as unknown as Partial<CheckedState>;
  const entities = new Set<string>();
  const time = new Map<string, number>();
  const fields = new Map<string, unknown>();
  const day = fuzzDay();
  const add = (entity: string, value: Record<string, unknown>): void => {
    entities.add(entity);
    const type = entity.split(':')[0];
    for (const field of WRITTEN_FIELDS[type]) {
      fields.set(`${entity}|${field}`, value[field]);
    }
  };
  for (const task of [
    ...Object.values(state.task?.entities ?? {}),
    ...Object.values(state.archiveYoung?.task.entities ?? {}),
  ]) {
    if (!task) continue;
    add(`task:${task.id}`, task as unknown as Record<string, unknown>);
    time.set(`task:${task.id}`, task.timeSpentOnDay?.[day] ?? 0);
  }
  for (const id of state.note?.ids ?? []) {
    const note = state.note?.entities[id];
    if (note) add(`note:${id}`, note as unknown as Record<string, unknown>);
  }
  for (const id of state.simpleCounter?.ids ?? []) {
    const habit = state.simpleCounter?.entities[id];
    if (!habit) continue;
    add(`habit:${id}`, habit as unknown as Record<string, unknown>);
    fields.set(`habit:${id}|countOnDay.${day}`, habit.countOnDay?.[day]);
  }
  return { clock: row.op.vectorClock, clientId: row.op.clientId, entities, time, fields };
};

/**
 * Whether the replacement keeps the intent, by rule 7's own classifier
 * (SyncImportFilterService): at or after the replacement's clock, or
 * CONCURRENT but provably after it (a later op of the replacing client, or
 * one whose reset clock holds the replacing client's counter).
 */
const isKeptBy = (entry: LedgerEntry, replacement: Replacement): boolean =>
  classifyOpAgainstSyncImport(
    { vectorClock: entry.clock, clientId: entry.clientId },
    { vectorClock: replacement.clock, clientId: replacement.clientId },
  ).shouldKeep;

const valueAt = (source: unknown, path: string[]): unknown =>
  path.reduce<unknown>(
    (value, key) =>
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)[key]
        : undefined,
    source,
  );

/** The differing leaf paths of two JSON-like values, at most `limit`. */
export const diffPaths = (
  a: unknown,
  b: unknown,
  limit = 20,
  path = '',
  found: string[] = [],
): string[] => {
  if (found.length >= limit || Object.is(a, b)) return found;
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    Array.isArray(a) === Array.isArray(b)
  ) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of [...keys].sort()) {
      diffPaths(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        limit,
        `${path}.${key}`,
        found,
      );
    }
    return found;
  }
  found.push(path || '.');
  return found;
};

/**
 * The synced state minus what legitimately differs per device:
 * - `modified`: reducers stamp it with the applying device's clock on every
 *   update (task CRUD, lwwUpdateMetaReducer), so it never converges;
 * - `isDataLoaded`: a runtime flag hydration sets on the task slice;
 * - `lastFlush`: write-only archive bookkeeping (ArchiveService), never read;
 * - empty objects, which equal a missing key (an archive flush run locally
 *   leaves `{}` where the remote flush leaves nothing).
 */
export const comparable = (state: unknown): unknown =>
  JSON.parse(JSON.stringify(state), (key, value: unknown) =>
    key === 'modified' ||
    key === 'isDataLoaded' ||
    key === 'lastFlush' ||
    (key !== '' &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
      ? undefined
      : value,
  );

const answerOf = (k: FuzzStep['k']): ImportDialogAnswer | undefined =>
  k === 'L' ? 'USE_LOCAL' : k === 'R' ? 'USE_REMOTE' : undefined;

const shortJson = (value: unknown): string => JSON.stringify(value)?.slice(0, 160) ?? '';

/**
 * Classifies a sync event without ids. A multi-entity stop keeps its side and
 * action type but not its entity count, which only follows list lengths.
 */
const eventSignature = (event: FuzzEvent): string => {
  const stop =
    event.kind === 'stop'
      ? /^(SYNC_MULTI_ENTITY_UNSUPPORTED side=\w+ actionType=.+?) entityCount=\d+$/.exec(
          event.detail,
        )
      : null;
  return stop
    ? `stop:${stop[1]}`
    : `${event.kind}:${event.detail
        .replace(/\b[tnhb]\d+\b|fuzzDev\w|\b[BEAI]_[A-Za-z0-9]{6}\b|[0-9a-f-]{36}/g, '*')
        .slice(0, 120)}`;
};

/** Strips the path of ids, indexes and days so it can classify a failure. */
const pathSignature = (path: string): string =>
  path
    .split('.')
    .slice(0, 6)
    .map((part, i, parts) =>
      parts[i - 1] === 'entities' ||
      /^\d+$|^[tnh]\d+$|^fuzzDev|^[BEAI]_[A-Za-z0-9]{6}$|^\d{4}-\d{2}-\d{2}$/.test(part)
        ? '*'
        : part,
    )
    .join('.');

export const runFuzz = async (options: FuzzOptions): Promise<FuzzResult> => {
  const started = performance.now();
  const harness = await SyncFuzzHarness.create();
  const failures: FuzzFailure[] = [];
  const fail = (signature: string, detail: string): void => {
    if (!failures.some((f) => f.signature === signature)) {
      // Wall-clock times and days depend on when the run started; keep them out.
      failures.push({
        signature,
        detail: detail
          .replace(/\b1[5-9]\d{11}\b/g, '<time>')
          .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<day>'),
      });
    }
  };
  const entries: LedgerEntry[] = [];
  const ownClock = async (): Promise<VectorClock> =>
    (await TestBed.inject(OperationLogStoreService).getVectorClock()) ?? {};
  /** Runs the intent on the current device and records it in the ledger. */
  const executeAndNote = async (intent: Intent): Promise<FuzzWrite[] | undefined> => {
    const store = TestBed.inject(OperationLogStoreService);
    const before = await ownClock();
    const seqBefore = await store.getLastSeq();
    const writes = await executeIntent(harness, intent);
    if (!writes) return undefined;
    const device = harness.current!;
    const ownOps = (await store.getOpsAfterSeq(seqBefore)).filter(
      (e) => e.op.clientId === device.clientId,
    );
    entries.push({
      intent,
      writes,
      device: device.name,
      clientId: device.clientId,
      clock: await ownClock(),
      counterBefore: before[device.clientId] ?? 0,
      time: Math.max(0, ...ownOps.map((e) => e.op.timestamp)),
      uploadedAt: Infinity,
      opaque: ownOps.some((e) => OPAQUE_ACTION_TYPES.has(e.op.actionType)),
    });
    return writes;
  };
  /** How many syncs ran; an intent's `uploadedAt` is its device's next one. */
  let syncCount = 0;
  /** Per device, the ledger length at its last USE_REMOTE rebuild. */
  const rebuiltAt = new Map<string, number>();
  /**
   * Whether a stop has been answered with USE_LOCAL: its force upload is a
   * user's replacement, so from then on the SYNC_IMPORT dialog it opens on
   * the other devices is answered too, in every mix.
   */
  let hasUserReplacement = false;
  /**
   * Syncs `device`, answering the SYNC_IMPORT conflict dialog with
   * `importAnswer` and the whole-dataset dialog after a stop with
   * `stopAnswer`. USE_REMOTE rebuilds the device from the server's history,
   * discarding its unsynced changes, as both dialogs say: the ledger excuses
   * those intents. USE_LOCAL after a stop force-uploads
   * the device's state, a replacement like the force upload intent's: the
   * oracles excuse what it drops through `lastReplacement`.
   */
  const sync = async (
    device: FuzzDevice,
    importAnswer?: ImportDialogAnswer,
    stopAnswer?: ImportDialogAnswer,
  ): Promise<void> => {
    const before = harness.events.length;
    harness.importDialogAnswer = importAnswer;
    harness.stopDialogAnswer = stopAnswer;
    await harness.sync(device);
    syncCount++;
    for (const entry of entries) {
      if (entry.device === device.name && entry.uploadedAt === Infinity) {
        entry.uploadedAt = syncCount;
      }
    }
    harness.importDialogAnswer = undefined;
    harness.stopDialogAnswer = undefined;
    const answeredLocal = harness.events
      .slice(before)
      .some((e) => e.kind === 'stop-dialog' && e.detail === 'USE_LOCAL');
    if (answeredLocal) hasUserReplacement = true;
    // USE_REMOTE (either dialog) drops exactly the ops the device still had
    // unsynced when it answered (`useRemoteDiscards`): an intent is excused
    // only if one of its ops was among them, so a write the server
    // acknowledged and then lost is still checked. A rebuild resets the
    // device's own counter to what the server knows, so later intents can
    // reuse the counters of discarded ones: only the intents since the
    // device's previous rebuild are matched.
    const discards = harness.useRemoteDiscards;
    harness.useRemoteDiscards = undefined;
    if (!discards) return;
    for (let i = rebuiltAt.get(device.name) ?? 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.device !== device.name || entry.discarded) continue;
      const counter = entry.clock[entry.clientId] ?? 0;
      if (
        discards.some(
          (op) =>
            op.clientId === entry.clientId &&
            op.counter > entry.counterBefore &&
            op.counter <= counter,
        )
      ) {
        entry.discarded = true;
      }
    }
    rebuiltAt.set(device.name, entries.length);
  };
  const devices = new Map<string, FuzzDevice>();
  for (const name of DEVICES) devices.set(name, await harness.addDevice(name));
  const deviceOf = (name: string): FuzzDevice => devices.get(name)!;

  // Setup: A creates the shared entities, then every device joins.
  await harness.as(deviceOf('A'), async () => {
    for (const intent of SETUP_INTENTS) {
      await executeAndNote(intent);
    }
  });
  for (const name of DEVICES) await sync(deviceOf(name));

  // Only a run that can replace state answers the SYNC_IMPORT conflict
  // dialog: a generated mix with a replacement intent, a trace with one, or
  // any run once a stop was answered with USE_LOCAL. Elsewhere the dialog
  // still fails the run, so a full-state op no user intent made keeps the
  // signatures of what it drops. (A backup export alone replaces nothing.)
  const replaces = options.steps
    ? options.steps.some((s) => s.a?.[0] === 'forceUpload' || s.a?.[0] === 'importBackup')
    : (options.weights ?? []).some(([kind]) => REPLACEMENT_INTENTS.has(kind));
  const answersImports = (): boolean => replaces || hasUserReplacement;
  // Which dialogs a run answers, and with what:
  //
  //   run                         | SYNC_IMPORT dialog          | dialog after a stop
  //   ----------------------------|-----------------------------|--------------------
  //   generated, `replace` mix    | step `k`, settle R          | step `k`, settle R
  //   generated, other mixes      | after a stop answered L:    | step `k` (own
  //                               |   step `k`, settle R        |   stream), settle R
  //   replay with a replacement   | step `k`, settle R          | step `k`, settle R
  //   replay with `k` only        | after a stop answered L     | step `k`, settle R
  //   replay without either       | never (fails the run)       | never (stop stays)
  //
  // A run models the whole-dataset dialog after a stop when it is generated,
  // or replays a trace with a replacement or a dialog answer (`k`). Its steps
  // answer with `k`, and settle with the remote data. A trace without either
  // keeps its stops unanswered, as every trace did before the dialog was
  // modeled. The stop stays a failure either way (#10377); what the answer
  // drops is judged in addition.
  const modelsStopDialog = !options.steps || replaces || options.steps.some((s) => s.k);

  const executed: FuzzStep[] = [];
  const runStep = async (step: FuzzStep, intent?: Intent): Promise<void> => {
    harness.tick();
    const device = deviceOf(step.d);
    let applied: Intent | undefined;
    if (intent) {
      await harness.as(device, async () => {
        if (await executeAndNote(intent)) applied = intent;
      });
    }
    if (step.s) {
      const answer = answerOf(step.k);
      await sync(device, answersImports() ? answer : undefined, answer);
    }
    if (step.c) await harness.compact(device);
    if (step.r) await harness.restart(device);
    if (applied || step.s || step.c || step.r) {
      executed.push({
        d: step.d,
        ...(applied ? { a: applied } : {}),
        ...(step.s ? { s: 1 } : {}),
        ...(step.c ? { c: 1 } : {}),
        ...(step.r ? { r: 1 } : {}),
        ...(step.s && step.k ? { k: step.k } : {}),
      });
    }
  };

  if (options.steps) {
    for (const step of options.steps) await runStep(step, step.a);
  } else {
    const random = createRandom(options.seed ?? 1);
    // Mixes without a replacement draw `k` from their own stream and keep it
    // only in a run that answered a stop, so their other traces stay as they
    // were.
    const dialogRandom = replaces
      ? random
      : createRandom((options.seed ?? 1) ^ DIALOG_STREAM_SALT);
    let idCounter = 10;
    const nextId = (prefix: string): string => `${prefix}${++idCounter}`;
    for (let i = 0; i < (options.stepCount ?? 30); i++) {
      const name = DEVICES[Math.floor(random() * DEVICES.length)];
      const intent = await harness.as(deviceOf(name), async () => {
        const archive = await TestBed.inject(ArchiveDbAdapter).loadArchiveYoung();
        const view = viewOf(await harness.state());
        const generated = generateIntent(
          random,
          view,
          archive?.task.ids ?? [],
          `${name}${i}`,
          nextId,
          options.weights,
          [...harness.backups.keys()],
        );
        if (generated && !isUiPossible(generated, view)) {
          throw new Error(
            `SyncFuzz: the generator emitted a step the UI does not offer: ${JSON.stringify(generated)}`,
          );
        }
        return generated;
      });
      await runStep(
        {
          d: name,
          ...(random() < SYNC_PROBABILITY ? { s: 1 } : {}),
          ...(random() < COMPACT_PROBABILITY ? { c: 1 } : {}),
          ...(random() < RESTART_PROBABILITY ? { r: 1 } : {}),
          k: dialogRandom() < USE_LOCAL_PROBABILITY ? 'L' : 'R',
        },
        intent,
      );
    }
  }

  // Settle: every device syncs until a full round moves nothing. In a run
  // that can replace state, a dialog asking about an incoming replacement is
  // answered with the remote data, which ends a run of competing replacements;
  // in a run that models it, so is the dialog after a stop.
  harness.tick();
  const settleStopAnswer: ImportDialogAnswer | undefined = modelsStopDialog
    ? 'USE_REMOTE'
    : undefined;
  const settle = (device: FuzzDevice): Promise<void> =>
    sync(device, answersImports() ? 'USE_REMOTE' : undefined, settleStopAnswer);
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    const seqBefore = harness.server.latestSeq;
    let pending = 0;
    for (const name of DEVICES) {
      await settle(deviceOf(name));
      pending += await harness.pendingOpCount(deviceOf(name));
    }
    if (harness.server.latestSeq === seqBefore && pending === 0) break;
  }
  const observer = await harness.addDevice('F');
  await settle(observer);

  // A generated mix without a replacement keeps `k` only in a run that
  // answered a stop, in a step or in settle: its replay then models the dialog
  // too (`modelsStopDialog`), and every other trace stays as it was.
  if (
    !options.steps &&
    !replaces &&
    !harness.events.some((e) => e.kind === 'stop-dialog')
  ) {
    for (const step of executed) delete step.k;
  }

  const eventsBeforeRestart = harness.events.length;
  // Oracle: no stops or other sync failures.
  for (const event of harness.events) {
    if (!FAILING_EVENTS.includes(event.kind)) continue;
    fail(eventSignature(event), `step ${event.step} ${event.device}: ${event.detail}`);
  }

  // Oracle: nothing pending, no full-state op anywhere but the user's own
  // replacements.
  for (const name of DEVICES) {
    const device = deviceOf(name);
    const pending = await harness.pendingOpCount(device);
    if (pending > 0) fail('pending', `${name} has ${pending} unsynced op(s)`);
    const fullState = await harness.as(device, async () =>
      (await TestBed.inject(OperationLogStoreService).getOpsAfterSeq(0)).filter(
        (e) =>
          FULL_STATE_OP_TYPES.has(e.op.opType) &&
          USER_REPLACEMENT_REASONS[e.op.opType] !== e.op.syncImportReason,
      ),
    );
    for (const entry of fullState) fail(`full-state-op:${entry.op.opType}`, `${name}`);
  }

  // Oracle: each device lists a note in Today exactly when it is pinned.
  const reference = await harness.syncedState(observer);
  for (const name of DEVICES) {
    checkTodayNotes(name, await harness.syncedState(deviceOf(name)), fail);
  }
  checkTodayNotes('fresh', reference, fail);

  // Oracle: convergence of every device with a fresh one.
  for (const name of DEVICES) {
    const state = await harness.syncedState(deviceOf(name));
    for (const diff of diffPaths(comparable(state), comparable(reference))) {
      const path = diff.slice(1).split('.');
      fail(
        `divergence:${pathSignature(diff)}`,
        `${name} vs fresh at ${diff}: ${shortJson(valueAt(state, path))} vs ${shortJson(
          valueAt(reference, path),
        )}`,
      );
    }
  }

  const replacement = lastReplacement(harness);
  checkPreservation(
    reference,
    new Ledger(
      entries.filter(
        (entry) => !entry.discarded && (!replacement || isKeptBy(entry, replacement)),
      ),
    ),
    replacement,
    fail,
  );

  // Oracle: a restart (hydration from the device's own database) keeps state.
  for (const name of DEVICES) {
    const before = comparable(await harness.syncedState(deviceOf(name)));
    await harness.restart(deviceOf(name));
    const after = await harness.syncedState(deviceOf(name));
    for (const diff of diffPaths(comparable(after), before)) {
      const path = diff.slice(1).split('.');
      fail(
        `restart-changed:${pathSignature(diff)}`,
        `${name} after vs before restart at ${diff}: ${shortJson(
          valueAt(after, path),
        )} vs ${shortJson(valueAt(before, path))}`,
      );
    }
  }
  for (const event of harness.events.slice(eventsBeforeRestart)) {
    if (FAILING_EVENTS.includes(event.kind)) {
      fail(`restart-${event.kind}:${event.detail.slice(0, 80)}`, `${event.device}`);
    }
  }
  // A REPAIR or failed validation is rare and hard to replay from its
  // signature alone: its failure carries the whole run.
  const needsDump = failures.filter((f) => IS_REPAIR_SIGNATURE.test(f.signature));
  const dump =
    options.debug || needsDump.length > 0
      ? await dumpRun(harness, [...devices.values()])
      : undefined;
  for (const failure of needsDump) {
    failure.detail += ` DUMP ${dump!
      .filter((line) => !SETUP_OP_LINE.test(line))
      .join(' ¦ ')}`;
  }
  return {
    steps: executed,
    failures,
    rejections: [
      ...new Set(harness.server.rejections.map((r) => `${r.errorCode} ${r.actionType}`)),
    ].sort(),
    ms: Math.round(performance.now() - started),
    ...(options.debug ? { dump } : {}),
  };
};

/** Failures whose detail gets the run's dump: a REPAIR op or a failed validation. */
export const IS_REPAIR_SIGNATURE = /REPAIR|^(restart-)?validation:/;
/** Dump lines of device A's setup ops (clock A only, counters 1-9). */
const SETUP_OP_LINE = /\{"fuzzDevA":[1-9]\}/;

const entityOfOp = (op: {
  entityType: string;
  entityId?: string;
  entityIds?: string[];
}): string =>
  `${op.entityType}:${op.entityIds?.length ? op.entityIds.join(',') : op.entityId}`;

/** A compact picture of a run for triage: server log, rejections, op logs. */
const dumpRun = async (
  harness: SyncFuzzHarness,
  devices: FuzzDevice[],
): Promise<string[]> => {
  const lines = harness.server.rows.map(
    ({ serverSeq, op }) =>
      `srv ${serverSeq} ${op.clientId} ${op.actionType} ${entityOfOp(op)} ` +
      `${op.opType}${op.syncImportReason ? ` ${op.syncImportReason}` : ''} ` +
      `${JSON.stringify(op.vectorClock)} ts+${op.timestamp % 1_000_000}`,
  );
  lines.push(...harness.server.rejections.map((r) => `rej ${JSON.stringify(r)}`));
  lines.push(...harness.events.map((e) => `evt ${JSON.stringify(e)}`));
  for (const device of devices) {
    const validation = await harness.as(device, () =>
      TestBed.inject(ValidateStateService).validateState(
        TestBed.inject(StateSnapshotService).getStateSnapshot() as unknown as Record<
          string,
          unknown
        >,
      ),
    );
    if (!validation.isValid) {
      lines.push(
        `${device.name} INVALID ${validation.crossModelError ?? ''} ` +
          shortJson(validation.typiaErrors).slice(0, 400),
      );
    }
    const entries = await harness.as(device, () =>
      TestBed.inject(OperationLogStoreService).getOpsAfterSeq(0),
    );
    for (const { seq, op, source, syncedAt, rejectedAt } of entries) {
      // A full-state payload is the whole state; a REPAIR's summary says what
      // validation found and repaired.
      const payload =
        op.opType === 'REPAIR'
          ? `repairSummary=${JSON.stringify(
              (op.payload as { repairSummary?: unknown } | null)?.repairSummary,
            )?.slice(0, 600)}`
          : shortJson(op.payload);
      lines.push(
        `${device.name} ${seq} ${source} ${op.clientId} ${op.actionType} ${entityOfOp(op)} ` +
          `${rejectedAt ? 'REJECTED' : syncedAt ? 'synced' : 'PENDING'} ` +
          `${JSON.stringify(op.vectorClock)} ${payload}`,
      );
    }
  }
  return lines;
};

interface EntityMap<T> {
  ids: string[];
  entities: Record<string, T | undefined>;
}

/** The slices the preservation oracles read. */
interface CheckedState {
  task: EntityMap<Task>;
  project: EntityMap<Project>;
  note: EntityMap<Note> & { todayOrder: string[] };
  simpleCounter: EntityMap<SimpleCounter>;
  archiveYoung: { task: EntityMap<Task> };
}

/**
 * The Today notes panel renders `note.todayOrder` unfiltered, and the pin
 * toggle reads `isPinnedToToday`, so they must agree on every device. The
 * convergence oracle misses a gap that all devices share.
 */
const checkTodayNotes = (
  device: string,
  snapshot: AppStateSnapshot,
  fail: (signature: string, detail: string) => void,
): void => {
  const { note } = snapshot as unknown as CheckedState;
  const listed = new Set(note.todayOrder);
  for (const id of note.ids) {
    const isPinned = !!note.entities[id]?.isPinnedToToday;
    if (isPinned !== listed.has(id)) {
      fail(
        `today-notes:${isPinned ? 'pinned-not-listed' : 'listed-not-pinned'}`,
        `${device}: ${id} isPinnedToToday=${isPinned}, todayOrder=${shortJson(note.todayOrder)}`,
      );
    }
  }
  for (const id of listed) {
    if (!note.entities[id]) {
      fail('today-notes:listed-missing', `${device}: ${id} is not a note`);
    }
  }
};

/**
 * Preservation of what the kept intents and the last replacement wrote.
 *
 * A deleted entity that is gone is not lost (`lost-entity`). One that
 * exists afterwards must have been recreated: its delete crossed a
 * concurrent intent on it and lost, and the entity came back from the
 * winning side's ops, with defaults outside them (decision 2 of
 * docs/sync-and-op-log/lww-field-level-resolution.md, accepted, "the fuzz
 * harness should count it"). Its fields and time are checked like any
 * other; the losses a recreate explains (a field reverted or not written,
 * lost time, a changed import value) are prefixed `recreated:`, so that
 * accepted residual is counted apart. A value some intent wrote that beats
 * a newer one (`older-write-won`) is not a recreate default and keeps its
 * own signature. A deleted entity that exists although no intent crossed its
 * delete came back unexplained: `resurrected:<type>`.
 *
 * Kept out, by design:
 * - what an edit or a tracked delta wrote while crossing an archive of its
 *   task: the archive wins (sync-core's planner);
 * - in the latest-write check below, the shapes LWW does not promise per
 *   field (see there).
 * Archived tasks are checked in the archive, like live ones.
 */
export const checkPreservation = (
  snapshot: AppStateSnapshot,
  ledger: Ledger,
  replacement: Replacement | undefined,
  fail: (signature: string, detail: string) => void,
): void => {
  const state = snapshot as unknown as CheckedState;
  const tasks = state.task.entities;
  const archived = state.archiveYoung.task.entities;
  const entityOf = (entity: string): Record<string, unknown> | undefined => {
    const [type, id] = entity.split(':');
    const found =
      type === 'task'
        ? (tasks[id] ?? archived[id])
        : type === 'note'
          ? state.note.entities[id]
          : state.simpleCounter.entities[id];
    return found as Record<string, unknown> | undefined;
  };

  for (const entity of new Set([...ledger.created, ...(replacement?.entities ?? [])])) {
    if (!ledger.deleted.has(entity) && !entityOf(entity)) {
      fail(`lost-entity:${entity.split(':')[0]}`, `${entity} was never deleted`);
    }
  }
  for (const entity of ledger.deleted) {
    if (entityOf(entity) && !ledger.deleteWasCrossed(entity)) {
      fail(
        `resurrected:${entity.split(':')[0]}`,
        `${entity} was deleted after every intent on it, and exists`,
      );
    }
  }

  /** The losses a recreate explains are counted apart (see above). */
  const signatureOf = (entity: string, signature: string): string =>
    ledger.deleted.has(entity) &&
    ledger.deleteWasCrossed(entity) &&
    RECREATE_LOSS.test(signature)
      ? `recreated:${signature}`
      : signature;
  const failOn =
    (entity: string) =>
    (signature: string, detail: string): void =>
      fail(signatureOf(entity, signature), detail);

  const day = fuzzDay();
  const trackedTasks = new Set([
    ...[...ledger.byEntity.keys()].filter((e) => ledger.trackedTime(e) !== undefined),
    ...(replacement?.time.keys() ?? []),
  ]);
  for (const entity of trackedTasks) {
    const task = entityOf(entity) as Task | undefined;
    if (ledger.deleted.has(entity) && !task) continue;
    const tracked = ledger.trackedTime(entity);
    const expected = (replacement?.time.get(entity) ?? 0) + (tracked ?? 0);
    if (tracked === undefined && expected === 0) continue;
    const actual = task?.timeSpentOnDay?.[day] ?? 0;
    if (actual !== expected) {
      failOn(entity)(
        'time-loss:task',
        `${entity}: tracked ${expected}, converged ${actual}`,
      );
    }
  }

  // The replacement's own field values, where no kept intent wrote the field
  // after it.
  for (const [key, value] of replacement?.fields ?? []) {
    if (ledger.writes.has(key)) continue;
    const [entity, field] = key.split('|');
    const current = entityOf(entity);
    if (!current) continue;
    const actual = valueAt(current, field.split('.'));
    if (!Object.is(actual, value)) {
      failOn(entity)(
        `import-field-changed:${entity.split(':')[0]}.${field.split('.')[0]}`,
        `${entity}.${field}: replacement ${shortJson(value)}, converged ${shortJson(actual)}`,
      );
    }
  }

  for (const [key, allWrites] of ledger.writes) {
    const [entity, field] = key.split('|');
    const current = entityOf(entity);
    if (!current) continue;
    const report = failOn(entity);
    const writes = allWrites.filter(({ entry }) => !ledger.crossesArchive(entity, entry));
    if (writes.length === 0) continue;
    const values = writes.map((w) => w.value);
    const actual = valueAt(current, field.split('.'));
    const type = entity.split(':')[0];
    const fieldName = field.split('.')[0];
    if (values.length === 1 && !Object.is(actual, values[0])) {
      report(
        `field-reverted:${type}.${fieldName}`,
        `${entity}.${field}: only write ${shortJson(values[0])}, converged ${shortJson(actual)}`,
      );
    } else if (!values.some((v) => Object.is(v, actual))) {
      report(
        `field-unwritten:${type}.${fieldName}`,
        `${entity}.${field}: writes ${shortJson(values)}, converged ${shortJson(actual)}`,
      );
    } else {
      checkLatestWrite(ledger, entity, field, writes, actual, report);
    }
  }

  const lists: [string, unknown][] = [
    ['note.todayOrder', state.note.todayOrder],
    ['project.noteIds', state.project.entities['INBOX_PROJECT']?.noteIds],
    ['project.taskIds', state.project.entities['INBOX_PROJECT']?.taskIds],
    ['simpleCounter.ids', state.simpleCounter.ids],
  ];
  for (const [name, list] of lists) {
    if (Array.isArray(list) && new Set(list).size !== list.length) {
      fail(`duplicate:${name}`, shortJson(list));
    }
  }
};

/**
 * Per-field last-writer-wins across devices: a field that several intents
 * wrote converges on the value of the one with the latest own edit time
 * (timestamp, then clientId, as sync-core's planner breaks ties).
 *
 * The latest write may lose only a conflict that LWW lets it lose. For every
 * intent of another device on the entity that is concurrent with it, the two
 * meet in one conflict (`Ledger.crossing`):
 * - through the field patch (both sides readable), each field goes to the
 *   side whose latest write of THAT field is newer (`localWinningFieldGroups`
 *   in conflict-field-patch.util.ts, #10422). The latest write is the newest
 *   write of its field on either side, so it wins every such conflict: none
 *   accounts for another value, whatever else the other side wrote later;
 * - on a whole-entity path (`crossing`'s `whole`, the shapes
 *   `isFieldPatchEligible` refuses), the side with the latest intent wins
 *   (sync-core's planner), and its snapshot can carry any value its device
 *   held: a write of that side or in its causal past accounts for it.
 *
 * This is a stricter model of the shapes the fuzz covers, not an exact model
 * of production: crossings are judged pairwise from intents, and a remote
 * restore or LWW `'replace'` row is approximated (see `WHOLE_ENTITY_INTENTS`
 * and `Ledger.crossing`).
 *
 * Two documented residuals still stamp fields later than they were written
 * (superseded re-emits and `_reemitSurvivingLocalFields`, see "What it
 * leaves" in lww-field-level-resolution.md). An older value one of them
 * carried reports as `older-write-won` too; no seed shows one yet.
 *
 * Out of scope, by design: NOTE fields, which stay on whole-entity LWW
 * (decision 4 of docs/sync-and-op-log/lww-field-level-resolution.md), and
 * habit counts (`countOnDay`), which are opaque (decision 6). A value no
 * intent wrote is `field-unwritten`'s, not this check's. Pending local LWW
 * rows (re-sends, whole-entity) are not in the ledger, which models intents.
 */
const checkLatestWrite = (
  ledger: Ledger,
  entity: string,
  field: string,
  writes: readonly LedgerWrite[],
  actual: unknown,
  fail: (signature: string, detail: string) => void,
): void => {
  const type = entity.split(':')[0];
  if (type === 'note' || field.startsWith('countOnDay')) return;
  const latest = writes.reduce((a, b) => (isLaterWrite(b.entry, a.entry) ? b : a));
  if (Object.is(actual, latest.value)) return;
  const accounted = (ledger.byEntity.get(entity) ?? []).some((other) => {
    if (other.device === latest.entry.device || !isConcurrent(other, latest.entry)) {
      return false;
    }
    const { aSide, bSide, whole } = ledger.crossing(entity, latest.entry, other);
    if (!whole || !isLaterWrite(latestOf(bSide), latestOf(aSide))) return false;
    // A whole-entity snapshot carries what its device held: its side's writes
    // and their causal past.
    const winner = latestOf(bSide);
    return writes.some(
      (w) =>
        Object.is(w.value, actual) &&
        (bSide.includes(w.entry) || isCausalPastOf(w.entry, winner)),
    );
  });
  if (accounted) return;
  fail(
    `older-write-won:${type}.${field.split('.')[0]}`,
    `${entity}.${field}: latest write ${shortJson(latest.value)} by ${latest.entry.device}, ` +
      `converged ${shortJson(actual)}`,
  );
};
