import { EnvironmentInjector, isSignal, ProviderToken } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { EffectsModule } from '@ngrx/effects';
import { Action, ActionReducer, MetaReducer, Store, StoreModule } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { openDB } from 'idb';
import { IDBFactory } from 'fake-indexeddb';
import {
  AsyncSubject,
  BehaviorSubject,
  firstValueFrom,
  Observable,
  of,
  ReplaySubject,
} from 'rxjs';
import { BannerService } from '../../../../core/banner/banner.service';
import { DateService } from '../../../../core/date/date.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { ClientIdService } from '../../../../core/util/client-id.service';
import { SnackParams } from '../../../../core/snack/snack.model';
import { boardsFeature } from '../../../../features/boards/store/boards.reducer';
import {
  CONFIG_FEATURE_NAME,
  globalConfigReducer,
} from '../../../../features/config/store/global-config.reducer';
import { issueProvidersFeature } from '../../../../features/issue/store/issue-provider.reducer';
import {
  menuTreeFeatureKey,
  menuTreeReducer,
} from '../../../../features/menu-tree/store/menu-tree.reducer';
import {
  METRIC_FEATURE_NAME,
  metricReducer,
} from '../../../../features/metric/store/metric.reducer';
import {
  NOTE_FEATURE_NAME,
  noteReducer,
} from '../../../../features/note/store/note.reducer';
import { plannerFeature } from '../../../../features/planner/store/planner.reducer';
import {
  PROJECT_FEATURE_NAME,
  projectReducer,
} from '../../../../features/project/store/project.reducer';
import {
  REMINDER_FEATURE_NAME,
  reminderReducer,
} from '../../../../features/reminder/store/reminder.reducer';
import {
  SECTION_FEATURE_NAME,
  sectionReducer,
} from '../../../../features/section/store/section.reducer';
import {
  SIMPLE_COUNTER_FEATURE_NAME,
  simpleCounterReducer,
} from '../../../../features/simple-counter/store/simple-counter.reducer';
import { TAG_FEATURE_NAME, tagReducer } from '../../../../features/tag/store/tag.reducer';
import {
  TASK_REPEAT_CFG_FEATURE_NAME,
  taskRepeatCfgReducer,
} from '../../../../features/task-repeat-cfg/store/task-repeat-cfg.reducer';
import {
  TASK_FEATURE_NAME,
  taskReducer,
} from '../../../../features/tasks/store/task.reducer';
import { timeTrackingFeature } from '../../../../features/time-tracking/store/time-tracking.reducer';
import { WORK_CONTEXT_FEATURE_NAME } from '../../../../features/work-context/store/work-context.selectors';
import { workContextReducer } from '../../../../features/work-context/store/work-context.reducer';
import {
  PLUGIN_METADATA_FEATURE_NAME,
  pluginMetadataReducer,
} from '../../../../plugins/store/plugin-metadata.reducer';
import {
  PLUGIN_USER_DATA_FEATURE_NAME,
  pluginUserDataReducer,
} from '../../../../plugins/store/plugin-user-data.reducer';
import { AppStateActions } from '../../../../root-store/app-state/app-state.actions';
import { appStateFeature } from '../../../../root-store/app-state/app-state.reducer';
import { META_REDUCERS } from '../../../../root-store/meta/meta-reducer-registry';
import { ArchiveOperationHandlerEffects } from '../../../apply/archive-operation-handler.effects';
import { ArchiveOperationHandler } from '../../../apply/archive-operation-handler.service';
import { HydrationStateService } from '../../../apply/hydration-state.service';
import {
  AppStateSnapshot,
  StateSnapshotService,
} from '../../../backup/state-snapshot.service';
import {
  clearDeferredActions,
  getDeferredActions,
  setOperationCaptureService,
} from '../../../capture/operation-capture.meta-reducer';
import { OperationCaptureService } from '../../../capture/operation-capture.service';
import { OperationLogEffects } from '../../../capture/operation-log.effects';
import { UnsupportedMultiEntityConflictError } from '../../../core/errors/sync-errors';
import { MAX_LWW_REUPLOAD_RETRIES } from '../../../core/operation-log.const';
import { PersistentAction } from '../../../core/persistent-action.interface';
import {
  DB_VERSION,
  SINGLETON_KEY,
  STORE_NAMES,
} from '../../../persistence/db-keys.const';
import { runDbUpgrade } from '../../../persistence/db-upgrade';
import { IndexedDbOpLogAdapter } from '../../../persistence/indexed-db-op-log-adapter';
import { OpLogDbAdapter } from '../../../persistence/op-log-db-adapter';
import { OP_LOG_DB_ADAPTER_FACTORY } from '../../../persistence/op-log-db-adapter.token';
import { BackupService } from '../../../backup/backup.service';
import { OperationLogCompactionService } from '../../../persistence/operation-log-compaction.service';
import { OperationLogHydratorService } from '../../../persistence/operation-log-hydrator.service';
import { OperationLogStoreService } from '../../../persistence/operation-log-store.service';
import { TabSeqFrontierService } from '../../../persistence/tab-seq-frontier.service';
import { ImmediateUploadService } from '../../../sync/immediate-upload.service';
import { OperationLogDownloadService } from '../../../sync/operation-log-download.service';
import { OperationLogSyncService } from '../../../sync/operation-log-sync.service';
import { OperationWriteFlushService } from '../../../sync/operation-write-flush.service';
import { RemoteOpsProcessingService } from '../../../sync/remote-ops-processing.service';
import { RejectedOpsHandlerService } from '../../../sync/rejected-ops-handler.service';
import { ServerMigrationService } from '../../../sync/server-migration.service';
import { SyncSessionValidationService } from '../../../sync/sync-session-validation.service';
import { countTransientRejections } from '../../../sync/upload-outcome.util';
import { SyncProviderManager } from '../../../sync-providers/provider-manager.service';
import { CLIENT_ID_PROVIDER } from '../../../util/client-id.provider';
import { RepairOperationService } from '../../../validation/repair-operation.service';
import { RepairSyncContextService } from '../../../validation/repair-sync-context.service';
import {
  FakeSuperSyncClient,
  FakeSuperSyncServer,
  FuzzUnsupportedTransportError,
} from './fake-super-sync-server';

/**
 * Multi-device SuperSync harness on ONE Angular injector and ONE NgRx store.
 *
 * Real: the root store with every synced feature reducer and the registered
 * META_REDUCERS, op capture (OperationLogEffects), OperationLogStoreService,
 * the download/upload/conflict/superseded/rejected-ops services and the
 * applier. Faked: the SuperSync transport (FakeSuperSyncServer), UI
 * (snacks, dialogs, translations) and the client-id source.
 *
 * Device isolation is per-device state swapping. `as(device, fn)` swaps in,
 * before `fn`, and back out after it:
 * - the NgRx state (FUZZ_SET_STATE, handled by the outermost meta-reducer);
 * - the op-log database: every OP_LOG_DB_ADAPTER_FACTORY adapter routes to the
 *   device's own IndexedDB (ops, vector clock, state cache, archives);
 * - the client id and the device's SuperSync client (its cursor);
 * - the in-memory service state listed in DEVICE_FIELDS.
 * Every other field of an instantiated app service must be listed in
 * SHARED_FIELDS with the reason it may be shared; the harness checks this
 * after every device turn and throws on an unlisted field. The check counts
 * functions, and Observables other than the Subjects that keep a value
 * (BehaviorSubject, ReplaySubject, AsyncSubject), as stateless, so it misses
 * state held in a `shareReplay` stream or a memoizing closure. Module-level
 * state is outside that check: the capture meta-reducer's deferred-action
 * buffer is drained at every step boundary, and undo-task-delete.meta-reducer.ts
 * keeps the last local task delete for undo, which the fuzz never runs.
 *
 * Known gaps against the app (SyncWrapperService._syncBody and the effects):
 * - no provider-switch detection, lastSyncedProviderId, WebSocket or
 *   immediate upload (stubbed), and no UI sync status;
 * - the track intent copies what starting a task does (TaskInternalEffects
 *   .reopenStartedDoneTask$ and planStartedTaskForToday$) and the tick flush,
 *   as one session that no sync interrupts. So it never needs
 *   autoAddTodayTagOnTracking, which re-plans a task that a remote change
 *   unplanned mid-session (once per task in a row, by its
 *   distinctUntilChanged memory);
 * - state replacements: the force upload and the backup import run the real
 *   services, and a step answers the SYNC_IMPORT conflict dialog and the
 *   whole-dataset conflict dialog after a stop (DialogSyncConflictComponent,
 *   see _answerStopDialog; a stop left unanswered is its cancel). Not run:
 *   cancelling the SYNC_IMPORT dialog as an answer, the
 *   server-migration confirm (closed unanswered), encryption changes and
 *   password changes (they need SyncWrapperService, the provider manager and
 *   deleteAllData), and restoring a SuperSync restore point or a local
 *   auto-backup.
 */

const FUZZ_SET_STATE = '[SyncFuzz] Set device state';
/** The real one, captured before any harness spies on it. */
const getRandomValues = crypto.getRandomValues.bind(crypto);
interface SetStateAction extends Action {
  state: object;
}

const deviceStateMetaReducer: MetaReducer =
  (reducer: ActionReducer<unknown>) =>
  (state: unknown, action: Action): unknown =>
    action.type === FUZZ_SET_STATE
      ? (action as SetStateAction).state
      : reducer(state, action);

/**
 * Per-device in-memory service state. Each entry is checked on start-up, so a
 * rename in production code fails the harness instead of leaking state.
 */
const DEVICE_FIELDS: ReadonlyArray<readonly [ProviderToken<object>, readonly string[]]> =
  [
    [
      OperationLogStoreService,
      [
        '_appliedOpIdsCache',
        '_cacheLastSeq',
        '_unsyncedCache',
        '_unsyncedCacheLastSeq',
        '_vectorClockCache',
      ],
    ],
    [TabSeqFrontierService, ['_frontier', '_hasForeignWrites']],
    [
      OperationLogDownloadService,
      [
        'hasWarnedClockDrift',
        '_hasUnseenRemoteOps',
        '_lastAnnouncedCheckpointSeq',
        'forcedDownloadCheckpoint',
        'clockDriftTimeoutId',
        'clockDriftRetryServerTimestamp',
      ],
    ],
    [RejectedOpsHandlerService, ['_resolutionAttemptsByEntity']],
    [
      OperationCaptureService,
      [
        'unrecoveredPersistFailure',
        'pendingCount',
        'pendingTaskTimeEntries',
        'hasWarnedAboutPending',
      ],
    ],
    [
      OperationLogEffects,
      ['inMemoryCompactionCounter', 'compactionFailures', 'writeCount'],
    ],
    // Read by compaction; set around each hydration run.
    [HydrationStateService, ['_isHydrationFallbackActive', '_isHydrationInProgress']],
    [SyncSessionValidationService, ['_failed', '_sessionActive']],
    [RepairSyncContextService, ['_baseServerSeqStack']],
    [OperationLogHydratorService, ['_migrationRanDuringHydration']],
    // Once-per-session latches: every device is its own app session.
    [RepairOperationService, ['_hasShownRepairSnackThisSession']],
    [OperationLogSyncService, ['_hasWarnedRebuildVersionBlockThisSession']],
    [
      RemoteOpsProcessingService,
      ['_hasWarnedVersionBlockThisSession', '_hasWarnedMigrationFailureThisSession'],
    ],
    [ServerMigrationService, ['_validationFailureNotified']],
  ];

const ROUTED =
  'the routed op-log adapter: every call reaches the current device database';
const SYNC_WINDOW =
  'the sync window gates selector-based feature effects, which the harness does not register';
const APPLY_WINDOW =
  'the remote-apply window, which _settle checks is closed at every step boundary';
const CONSTANT = 'a constant';

/**
 * In-memory service state that devices share on purpose, by class name and
 * field, with the reason (SHARED_CLASSES: every field of a class). Injected
 * services, functions and streams that keep no value (Observable, Subject)
 * need no entry; signals, BehaviorSubjects and plain values do.
 */
const SHARED_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  OperationLogStoreService: { _adapter: ROUTED, _db: ROUTED, _initPromise: ROUTED },
  ArchiveStoreService: { _adapter: ROUTED, _db: ROUTED, _initPromise: ROUTED },
  OperationLogEffects: {
    isHandlingQuotaExceeded:
      'set only on a storage-quota error, which the fuzz never hits',
    lastStorageQuotaSnackAt:
      'set only on a storage-quota error, which the fuzz never hits',
    STORAGE_QUOTA_SNACK_DEDUPE_MS: CONSTANT,
    _deferredProcessingChain: 'settled at every step boundary: _settle drains it',
  },
  OperationCaptureService: { PENDING_WARNING_THRESHOLD: CONSTANT },
  OperationWriteFlushService: {
    MAX_WAIT_TIME: CONSTANT,
    MAX_CUTOFF_ATTEMPTS: CONSTANT,
    POLL_INTERVAL: CONSTANT,
  },
  HydrationStateService: {
    _isApplyingRemoteOps: APPLY_WINDOW,
    _isDirectApplyActive: APPLY_WINDOW,
    _applyingRemoteOpsHoldCount: APPLY_WINDOW,
    _isInPostSyncCooldown: SYNC_WINDOW,
    _isSyncWindowOpen: SYNC_WINDOW,
    _cooldownTimer: SYNC_WINDOW,
    _syncWindowFailsafeTimer: SYNC_WINDOW,
    isInSyncWindow: SYNC_WINDOW,
  },
  LockService: {
    _fallbackLocks: 'unused where Web Locks exist; no lock outlives a step',
    _hasWarnedAboutMissingLocks: 'a log-only warn-once flag',
  },
  TaskTimeSyncService: {
    _accumulator:
      'filled only by TaskService ticks; the track intent dispatches the flush itself',
  },
  LegacyPfDbService: { _tabId: 'the identity of the one browser tab' },
  BackupService: {
    _protectedBackupId:
      'set only inside restoreImportBackupById, which the fuzz never runs',
  },
  DateService: {
    startOfNextDayDiff: 'from the start-of-day setting, which the fuzz keeps',
  },
};

/** App services whose whole in-memory state devices share on purpose, with the reason. */
const SHARED_CLASSES: Readonly<Record<string, string>> = {
  SuperSyncStatusService: 'a UI indicator the sync path only writes to',
  ImexViewService:
    'the data-import flag, set only while a backup import runs in one step',
  UserInputWaitStateService: 'set while a dialog waits; recorded dialogs close at once',
  GlobalConfigService: 'derived from the global config, which the fuzz never edits',
  LanguageService: 'the UI language, which the fuzz never changes',
  DateTimeFormatService: 'the UI locale, which the fuzz never changes',
};

/** Angular, NgRx and test-bed classes: framework machinery, or the store that FUZZ_SET_STATE swaps. */
const FRAMEWORK_CLASSES: ReadonlySet<string> = new Set([
  'ActionsSubject',
  'Actions',
  'AfterRenderManager',
  'ApplicationInitStatus',
  'ApplicationModule',
  'ApplicationRef',
  'BrowserDynamicTestingModule',
  'BrowserModule',
  'BrowserTestingModule',
  'ChangeDetectionSchedulerImpl',
  'CommonModule',
  'ComponentFactoryResolver',
  'DomEventsPlugin',
  'DomRendererFactory2',
  'DynamicTestModule',
  'EffectSources',
  'EffectsFeatureModule',
  'EffectsRootModule',
  'EffectsRunner',
  'ErrorHandler',
  'EventManager',
  'KeyEventsPlugin',
  'NgModuleRef',
  'NoopNgZone',
  'PendingTasksInternal',
  'R3Injector',
  'ReducerManager',
  'RootScopeModule',
  'ScannedActionsSubject',
  'SharedStylesHost',
  'State',
  'Store',
  'StoreFeatureModule',
  'StoreRootModule',
  'TestBedApplicationErrorHandler',
  'ZoneAwareEffectScheduler',
]);

/**
 * The source class name, which the tables above and recorded dialog names
 * use. The esbuild bundle
 * renames classes whose names collide (`LockService2`, NgRx's `_State`), but
 * some real names end in a digit (`_DomRendererFactory2`), so a listed name
 * wins before the bundler's suffix is stripped.
 */
const sourceClassName = (name: string): string => {
  const unprefixed = name.replace(/^_/, '');
  const isListed =
    FRAMEWORK_CLASSES.has(unprefixed) ||
    !!SHARED_CLASSES[unprefixed] ||
    !!SHARED_FIELDS[unprefixed];
  return isListed ? unprefixed : unprefixed.replace(/\d+$/, '');
};

/** True for a value no device owns: a function, or a stream that retains nothing. */
const isStateless = (value: unknown): boolean =>
  (typeof value === 'function' && !isSignal(value)) ||
  (value instanceof Observable &&
    !(
      value instanceof BehaviorSubject ||
      value instanceof ReplaySubject ||
      value instanceof AsyncSubject
    ));

type FieldValues = Map<object, Record<string, unknown>>;

const fieldsOf = (instance: object): Record<string, unknown> =>
  instance as unknown as Record<string, unknown>;

export interface FuzzDevice {
  readonly name: string;
  /**
   * `fuzzDev<name>` until a backup import or clean slate rotates it: then
   * the id OperationLogStoreService.runDestructiveStateReplacement wrote to
   * the device's database, re-read after the store clears the id cache.
   */
  clientId: string;
  clientIdStale?: boolean;
  readonly client: FakeSuperSyncClient;
  readonly db: IndexedDbOpLogAdapter;
  state: object;
  fields?: FieldValues;
}

export type FuzzEventKind =
  | 'stop' // UnsupportedMultiEntityConflictError (SYNC_MULTI_ENTITY_UNSUPPORTED)
  | 'sync-error'
  | 'sync-halted'
  | 'full-state' // a full-state upload was deferred, or needed an unmodeled transport
  | 'validation'
  | 'permanent-rejection'
  | 'lww-retries-exhausted'
  | 'dialog'
  | 'import-dialog' // the SYNC_IMPORT conflict dialog, answered by the step (`k`)
  | 'stop-dialog' // the whole-dataset dialog after a `stop`, answered by the step (`k`)
  | 'error-snack'
  | 'dev-error';

export interface FuzzEvent {
  step: number;
  device: string;
  kind: FuzzEventKind;
  detail: string;
}

/** Deterministic wall clock: each step starts a minute after the previous one. */
class FuzzClock {
  private _stepBase: number;
  private _offset = 0;
  constructor(start: number) {
    this._stepBase = start;
  }
  now(): number {
    return this._stepBase + this._offset++;
  }
  nextStep(): void {
    this._stepBase += 60_000;
    this._offset = 0;
  }
}

/** A dialog stub: records every dialog and closes it with `onOpen`'s answer. */
const recordingDialog = (onOpen: (name: string) => unknown): Partial<MatDialog> => ({
  open: ((component: { name?: string }) => {
    const answer = onOpen(component?.name ? sourceClassName(component.name) : 'dialog');
    return { afterClosed: () => of(answer), close: () => undefined };
  }) as unknown as MatDialog['open'],
  openDialogs: [],
});

/**
 * The replacing answers of DialogSyncImportConflictComponent
 * (SyncImportConflictResolution) and of DialogSyncConflictComponent after a
 * stop (ConflictResolutionResult); both dialogs use the same two.
 */
export type ImportDialogAnswer = 'USE_LOCAL' | 'USE_REMOTE';

export class SyncFuzzHarness {
  /** Bumped by every new harness: an older one must no longer touch TestBed. */
  private static _generation = 0;
  private readonly _generation = ++SyncFuzzHarness._generation;
  readonly server: FakeSuperSyncServer;
  readonly devices: FuzzDevice[] = [];
  readonly events: FuzzEvent[] = [];
  /**
   * Backup files the user exported (FileImexComponent.downloadBackup), by
   * label; any device can import one.
   */
  readonly backups = new Map<
    string,
    Parameters<BackupService['importCompleteBackup']>[0]
  >();
  /**
   * The user's answer to the SYNC_IMPORT conflict dialog while it is set.
   * Unset, the dialog closes like any other: CANCEL, recorded as `dialog`.
   */
  importDialogAnswer?: ImportDialogAnswer;
  /**
   * The user's answer to the whole-dataset conflict dialog
   * (DialogSyncConflictComponent) after a multi-entity stop, while it is set.
   * Unset, the stop is all that happens, as before the dialog was modeled.
   */
  stopDialogAnswer?: ImportDialogAnswer;
  /**
   * The ops a USE_REMOTE answer discarded, in either dialog: the device's
   * unsynced ops right before each successful rebuild
   * (OperationLogSyncService.forceDownloadRemoteState), by client id and own
   * vector-clock counter. The runner reads and clears it after every sync.
   */
  useRemoteDiscards?: { clientId: string; counter: number }[];
  step = 0;
  private _current?: FuzzDevice;
  private readonly _clock: FuzzClock;
  private _pristineState!: object;
  private _pristineFields!: FieldValues;
  private readonly _deviceFieldNames = new Map<object, ReadonlySet<string>>();

  private constructor() {
    // Local noon of the real day: a run never crosses midnight, in any time
    // zone, and its "today" matches `new Date()` in app code.
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    this._clock = new FuzzClock(noon.getTime());
    (jasmine.isSpy(Date.now)
      ? (Date.now as jasmine.Spy)
      : spyOn(Date, 'now')
    ).and.callFake(() => this._clock.now());
    this.server = new FakeSuperSyncServer(() => Date.now());
    (jasmine.isSpy(crypto.getRandomValues)
      ? (crypto.getRandomValues as jasmine.Spy)
      : spyOn(crypto, 'getRandomValues')
    ).and.callFake((array: Uint8Array) => {
      const random = this._seededRandom;
      if (!random || !(array instanceof Uint8Array)) return getRandomValues(array);
      for (let i = 0; i < array.length; i++) array[i] = Math.floor(random() * 256);
      return array;
    });
  }

  private _seededRandom?: () => number;

  /**
   * Runs `fn` with crypto.getRandomValues seeded from `seed`. A backup import
   * mints the device's new client id from it (generateClientId), and conflict
   * ties compare client ids, so a replayed trace must mint the same one.
   */
  async withSeededRandom<T>(seed: string, fn: () => Promise<T>): Promise<T> {
    let hash = 0;
    for (const char of seed) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
    let a = hash;
    this._seededRandom = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    try {
      return await fn();
    } finally {
      this._seededRandom = undefined;
    }
  }

  /** Restores the global confirm() default of src/test.ts. */
  static dispose(): void {
    (window.confirm as jasmine.Spy).and.returnValue(true);
  }

  /** Configures TestBed; call from an `it`/`beforeEach` with a fresh module. */
  static async create(): Promise<SyncFuzzHarness> {
    const harness = new SyncFuzzHarness();
    harness._configure();
    await harness._init();
    return harness;
  }

  get current(): FuzzDevice | undefined {
    return this._current;
  }

  tick(): void {
    this.step++;
    this._clock.nextStep();
  }

  record(device: FuzzDevice | undefined, kind: FuzzEventKind, detail: string): void {
    this.events.push({ step: this.step, device: device?.name ?? '-', kind, detail });
  }

  private _configure(): void {
    // A spec may run several traces (shrinking): start from a fresh module and
    // isolate this harness' databases from any earlier harness.
    TestBed.resetTestingModule();
    Object.defineProperty(globalThis, 'indexedDB', {
      value: new IDBFactory(),
      configurable: true,
      writable: true,
    });
    clearDeferredActions();
    const routed = (): OpLogDbAdapter => {
      if (!this._current) throw new Error('SyncFuzz: op-log access outside a device');
      return this._current.db;
    };
    // The services still open their own SUP_OPS connection; it is ignored.
    const routingAdapter = new Proxy({} as OpLogDbAdapter, {
      get: (_target, prop) =>
        prop === 'adoptConnection' || prop === 'close'
          ? () => undefined
          : (...args: unknown[]) => {
              const target = routed() as unknown as Record<
                string | symbol,
                (...a: unknown[]) => unknown
              >;
              return target[prop](...args);
            },
    });
    const clientId = async (): Promise<string> => {
      const device = this._device();
      if (device.clientIdStale) {
        const stored = await device.db.get<string>(STORE_NAMES.CLIENT_ID, SINGLETON_KEY);
        device.clientId = stored ?? device.clientId;
        device.clientIdStale = false;
      }
      return device.clientId;
    };
    const clientIds = {
      loadClientId: clientId,
      getOrGenerateClientId: clientId,
      clearCache: () => {
        this._device().clientIdStale = true;
      },
    };
    const onDialog = (name: string): unknown => {
      const answer = this.importDialogAnswer;
      if (name === 'DialogSyncImportConflictComponent' && answer) {
        this.record(this._current, 'import-dialog', answer);
        return answer;
      }
      this.record(this._current, 'dialog', `MatDialog.open(${name})`);
      return undefined;
    };
    TestBed.configureTestingModule({
      imports: [
        StoreModule.forRoot(undefined, {
          metaReducers: [deviceStateMetaReducer, ...META_REDUCERS],
        }),
        StoreModule.forFeature(appStateFeature),
        StoreModule.forFeature(CONFIG_FEATURE_NAME, globalConfigReducer),
        StoreModule.forFeature(issueProvidersFeature),
        StoreModule.forFeature(METRIC_FEATURE_NAME, metricReducer),
        StoreModule.forFeature(NOTE_FEATURE_NAME, noteReducer),
        StoreModule.forFeature(PROJECT_FEATURE_NAME, projectReducer),
        StoreModule.forFeature(menuTreeFeatureKey, menuTreeReducer),
        StoreModule.forFeature(SIMPLE_COUNTER_FEATURE_NAME, simpleCounterReducer),
        StoreModule.forFeature(SECTION_FEATURE_NAME, sectionReducer),
        StoreModule.forFeature(TAG_FEATURE_NAME, tagReducer),
        StoreModule.forFeature(TASK_REPEAT_CFG_FEATURE_NAME, taskRepeatCfgReducer),
        StoreModule.forFeature(TASK_FEATURE_NAME, taskReducer),
        StoreModule.forFeature(WORK_CONTEXT_FEATURE_NAME, workContextReducer),
        StoreModule.forFeature(boardsFeature),
        StoreModule.forFeature(timeTrackingFeature),
        StoreModule.forFeature(plannerFeature),
        StoreModule.forFeature(PLUGIN_USER_DATA_FEATURE_NAME, pluginUserDataReducer),
        StoreModule.forFeature(PLUGIN_METADATA_FEATURE_NAME, pluginMetadataReducer),
        StoreModule.forFeature(REMINDER_FEATURE_NAME, reminderReducer),
        EffectsModule.forRoot([]),
        EffectsModule.forFeature([OperationLogEffects, ArchiveOperationHandlerEffects]),
      ],
      providers: [
        { provide: OP_LOG_DB_ADAPTER_FACTORY, useValue: () => routingAdapter },
        { provide: CLIENT_ID_PROVIDER, useValue: clientIds },
        { provide: ClientIdService, useValue: clientIds },
        { provide: ImmediateUploadService, useValue: { trigger: () => undefined } },
        {
          provide: SyncProviderManager,
          useValue: {
            syncEpoch: 0,
            configEpoch: 0,
            isSyncInProgress: false,
            assertSyncEpochUnchanged: () => undefined,
            setSyncStatus: () => undefined,
            bumpSyncEpoch: () => undefined,
          },
        },
        {
          provide: SnackService,
          useValue: {
            open: (params: SnackParams | string) => {
              if (typeof params !== 'string' && params.type === 'ERROR') {
                this.record(this._current, 'error-snack', String(params.msg));
              }
            },
            hasPendingPersistentAction: () => false,
            close: () => undefined,
          },
        },
        { provide: BannerService, useValue: { open: () => undefined } },
        { provide: MatDialog, useValue: recordingDialog(onDialog) },
        {
          provide: TranslateService,
          useValue: {
            instant: (key: string) => key,
            get: (key: string) => of(key),
            stream: (key: string) => of(key),
          },
        },
      ],
    });
  }

  private async _init(): Promise<void> {
    setOperationCaptureService(TestBed.inject(OperationCaptureService));
    // Effects subscribe when the store is created.
    TestBed.inject(OperationLogEffects);
    // Local archive writes (ArchiveOperationHandlerEffects) and triggered or
    // post-hydration compaction run detached from their caller; a step must
    // not end, and the device swap out, before they wrote to this device's
    // database.
    this._trackInFlight(TestBed.inject(ArchiveOperationHandler), 'handleOperation');
    this._trackInFlight(TestBed.inject(OperationLogCompactionService), 'compact');
    this._trackInFlight(
      TestBed.inject(OperationLogCompactionService),
      'compactIfBloated',
    );
    this._recordUseRemoteDiscards();
    // Every device starts on the fuzz day, as setStartOfNextDayDiffOnLoad
    // sets it after loadAllData; the store's initial todayStr is the real
    // date when the bundle loaded.
    const dates = TestBed.inject(DateService);
    TestBed.inject(Store).dispatch(
      AppStateActions.setTodayString({
        todayStr: dates.todayStr(),
        startOfNextDayDiffMs: dates.getStartOfNextDayDiffMs(),
      }),
    );
    this._pristineState = await firstValueFrom(TestBed.inject(Store));
    this._pristineFields = new Map();
    for (const [token, names] of DEVICE_FIELDS) {
      const instance = TestBed.inject(token);
      const values: Record<string, unknown> = {};
      for (const name of names) {
        if (!(name in instance)) {
          throw new Error(`SyncFuzz: ${instance.constructor.name}.${name} is gone`);
        }
        values[name] = structuredClone(fieldsOf(instance)[name]);
      }
      this._pristineFields.set(instance, values);
      this._deviceFieldNames.set(instance, new Set(names));
    }
    this._checkServiceFields();
    // devError() confirms before throwing; answer "no" as production builds do
    // and record it. Every other confirm is the fresh-client prompt: accept.
    (window.confirm as jasmine.Spy).and.callFake((message?: string) => {
      if (message?.startsWith('Throw an error for error?')) {
        this.record(this._current, 'dev-error', message.slice(0, 300));
        return false;
      }
      return true;
    });
  }

  private _device(): FuzzDevice {
    if (!this._current) throw new Error('SyncFuzz: no device swapped in');
    return this._current;
  }

  async addDevice(name: string): Promise<FuzzDevice> {
    const connection = await openDB(`SUP_OPS_FUZZ_${name}`, DB_VERSION, {
      upgrade: (db, oldVersion, _newVersion, transaction) =>
        runDbUpgrade(db, oldVersion, transaction),
    });
    const db = new IndexedDbOpLogAdapter();
    db.adoptConnection(connection);
    const device: FuzzDevice = {
      name,
      clientId: `fuzzDev${name}`,
      client: new FakeSuperSyncClient(this.server),
      db,
      state: this._pristineState,
    };
    this.devices.push(device);
    return device;
  }

  /** Runs `fn` as `device`: swap in, run, let capture settle, swap out. */
  async as<T>(device: FuzzDevice, fn: () => Promise<T>): Promise<T> {
    this._assertLive();
    if (this._current) {
      throw new Error(`SyncFuzz: ${device.name} while ${this._current.name} is active`);
    }
    this._current = device;
    TestBed.inject(Store).dispatch({ type: FUZZ_SET_STATE, state: device.state });
    this._restoreFields(device.fields);
    try {
      return await fn();
    } finally {
      await this._settle();
      device.state = await firstValueFrom(TestBed.inject(Store));
      device.fields = this._saveFields();
      this._current = undefined;
      this._checkServiceFields();
    }
  }

  /**
   * A spec that timed out can leave its harness running while the next spec
   * builds a new one on the shared TestBed; stop the old one at its next step.
   */
  private _assertLive(): void {
    if (this._generation !== SyncFuzzHarness._generation) {
      throw new Error(
        'SyncFuzz: a stale harness (its spec probably timed out) tried to drive ' +
          'the TestBed of a newer harness',
      );
    }
  }

  /**
   * Fails on in-memory state of an instantiated app service that is neither
   * swapped per device (DEVICE_FIELDS) nor shared on purpose (SHARED_FIELDS),
   * so a new service field cannot leak between devices unnoticed.
   */
  private _checkServiceFields(): void {
    const injector = TestBed.inject(EnvironmentInjector) as unknown as {
      records: Map<unknown, { value: unknown } | null | undefined>;
    };
    const values = [...injector.records.values()].map((record) => record?.value);
    const injected = new Set(
      values.filter(
        (value) =>
          (typeof value === 'object' && value !== null) || typeof value === 'function',
      ),
    );
    const unlisted: string[] = [];
    for (const instance of values) {
      if (!instance || typeof instance !== 'object' || Array.isArray(instance)) continue;
      const rawName = instance.constructor?.name;
      if (!rawName) continue;
      const name = sourceClassName(rawName);
      if (name === 'Object' || FRAMEWORK_CLASSES.has(name)) continue;
      if (SHARED_CLASSES[name]) continue;
      const device = this._deviceFieldNames.get(instance);
      const shared = SHARED_FIELDS[name];
      for (const [field, value] of Object.entries(instance)) {
        if (device?.has(field) || shared?.[field]) continue;
        if (injected.has(value) || isStateless(value)) continue;
        unlisted.push(`${name}.${field}`);
      }
    }
    if (unlisted.length > 0) {
      throw new Error(
        'SyncFuzz: service state that is neither per device (DEVICE_FIELDS) nor ' +
          `shared on purpose (SHARED_FIELDS): ${unlisted.join(', ')}`,
      );
    }
  }

  /**
   * Restarts the device like an app reload: an empty store and pristine
   * in-memory service state, then the real startup hydration from the
   * device's database (OperationLogHydratorService.hydrateStore).
   */
  async restart(device: FuzzDevice): Promise<void> {
    device.state = this._pristineState;
    device.fields = undefined;
    await this.as(device, () =>
      TestBed.inject(OperationLogHydratorService).hydrateStore(),
    );
  }

  /** Compacts the device's op log: a state-cache snapshot, then pruning. */
  async compact(device: FuzzDevice): Promise<void> {
    await this.as(device, () => TestBed.inject(OperationLogCompactionService).compact());
  }

  /** Dispatches a local user action on the current device and waits for capture. */
  async dispatch(action: Action | PersistentAction): Promise<void> {
    this._assertLive();
    this._device();
    TestBed.inject(Store).dispatch(action);
    await this._settle();
  }

  state(): Promise<Record<string, unknown>> {
    return firstValueFrom(TestBed.inject(Store)) as Promise<Record<string, unknown>>;
  }

  /**
   * Both dialogs' USE_REMOTE rebuild through forceDownloadRemoteState, which
   * drops every unsynced op of the device (the non-resume path keeps none):
   * record them once the rebuild succeeds.
   */
  private _recordUseRemoteDiscards(): void {
    const syncService = TestBed.inject(OperationLogSyncService);
    const original = syncService.forceDownloadRemoteState.bind(syncService);
    syncService.forceDownloadRemoteState = async (...args) => {
      const unsynced = await TestBed.inject(OperationLogStoreService).getUnsynced();
      await original(...args);
      this.useRemoteDiscards = [
        ...(this.useRemoteDiscards ?? []),
        ...unsynced.map(({ op }) => ({
          clientId: op.clientId,
          counter: op.vectorClock[op.clientId] ?? 0,
        })),
      ];
    };
  }

  private readonly _inFlight = new Set<Promise<unknown>>();

  private _trackInFlight<T extends object>(instance: T, method: keyof T & string): void {
    const target = instance as unknown as Record<string, (...a: unknown[]) => unknown>;
    const original = target[method].bind(instance);
    target[method] = (...args: unknown[]) => {
      const result = Promise.resolve(original(...args));
      this._inFlight.add(result);
      void result.finally(() => this._inFlight.delete(result)).catch(() => undefined);
      return result;
    };
  }

  private async _settle(): Promise<void> {
    this._assertLive();
    do {
      await TestBed.inject(OperationWriteFlushService).flushPendingWrites();
      await Promise.allSettled([...this._inFlight]);
    } while (this._inFlight.size > 0);
    if (getDeferredActions().length > 0) {
      await TestBed.inject(OperationLogEffects).processDeferredActions();
    }
    if (TestBed.inject(HydrationStateService).isApplyingRemoteOps()) {
      throw new Error('SyncFuzz: remote apply still open at a step boundary');
    }
  }

  private _saveFields(): FieldValues {
    const saved: FieldValues = new Map();
    for (const instance of this._pristineFields.keys()) {
      const values: Record<string, unknown> = {};
      for (const name of Object.keys(this._pristineFields.get(instance)!)) {
        values[name] = fieldsOf(instance)[name];
      }
      saved.set(instance, values);
    }
    return saved;
  }

  private _restoreFields(saved?: FieldValues): void {
    for (const [instance, pristine] of this._pristineFields) {
      const values = saved?.get(instance) ?? structuredClone(pristine);
      Object.assign(fieldsOf(instance), values);
    }
  }

  /**
   * One sync as SyncWrapperService._syncBody runs it for SuperSync: download,
   * upload, then the bounded re-upload of local-win / transiently rejected ops.
   * Returns false when sync did not complete cleanly (see `events`).
   */
  async sync(device: FuzzDevice): Promise<boolean> {
    const before = this.events.length;
    await this.as(device, async () => {
      const syncService = TestBed.inject(OperationLogSyncService);
      const session = TestBed.inject(SyncSessionValidationService);
      await session.withSession(async () => {
        try {
          await this._syncBody(device, syncService, session);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (e instanceof UnsupportedMultiEntityConflictError) {
            this.record(device, 'stop', message);
            await this._answerStopDialog(device, syncService, session);
          } else if (e instanceof FuzzUnsupportedTransportError) {
            this.record(device, 'full-state', message);
          } else {
            this.record(device, 'sync-error', `${(e as Error)?.name}: ${message}`);
          }
        }
      });
    });
    return this.events.length === before;
  }

  private async _syncBody(
    device: FuzzDevice,
    syncService: OperationLogSyncService,
    session: SyncSessionValidationService,
  ): Promise<void> {
    const isNeverSynced = !(await syncService.hasSyncedOps());
    const down = await syncService.downloadRemoteOps(device.client, {
      isNeverSynced,
      keepDecryptedPrefix: true,
    });
    const halt = (phase: string, kind: string): void =>
      this.record(device, 'sync-halted', `${phase} ${kind}`);
    if (
      down.kind === 'cancelled' ||
      down.kind === 'server_migration_skipped' ||
      down.kind === 'blocked_incompatible'
    ) {
      halt('download', down.kind);
      return;
    }
    let up = await syncService.uploadPendingOps(device.client, { isNeverSynced });
    if (up.kind === 'cancelled' || up.kind === 'blocked_incompatible') {
      halt('upload', up.kind);
      return;
    }
    if (up.kind === 'completed' && up.encryptionRequiredKeyMissing) {
      halt('upload', 'encryptionRequiredKeyMissing');
      return;
    }
    const completed: Extract<typeof up, { kind: 'completed' }>[] = [];
    const permanent = (): void => {
      if (up.kind !== 'completed') return;
      completed.push(up);
      if (up.permanentRejectionCount > 0) {
        this.record(
          device,
          'permanent-rejection',
          `${up.permanentRejectionCount} op(s): ` +
            up.rejectedOps.map((r) => r.errorCode).join(','),
        );
      }
    };
    permanent();
    let pending =
      (down.kind === 'ops_processed' ? down.localWinOpsCreated : 0) +
      (up.kind === 'completed'
        ? up.localWinOpsCreated + countTransientRejections(up)
        : 0);
    for (let retry = 0; pending > 0 && retry < MAX_LWW_REUPLOAD_RETRIES; retry++) {
      up = await syncService.uploadPendingOps(device.client, { isNeverSynced });
      if (up.kind === 'cancelled' || up.kind === 'blocked_incompatible') {
        halt('re-upload', up.kind);
        return;
      }
      permanent();
      pending =
        up.kind === 'completed'
          ? up.localWinOpsCreated + countTransientRejections(up)
          : 0;
    }
    if (completed.some((result) => result.blockedByRejectedFullState)) {
      halt('upload', 'blockedByRejectedFullState');
    }
    if (pending > 0) {
      this.record(device, 'lww-retries-exhausted', `${pending} op(s) still pending`);
    }
    if (completed.some((result) => result.fullStateUploadDeferred)) {
      this.record(device, 'full-state', 'full-state upload deferred');
    }
    if (session.hasFailed())
      this.record(device, 'validation', 'state invalid after sync');
  }

  /**
   * The whole-dataset conflict dialog after a multi-entity stop, answered
   * with `stopDialogAnswer` as SyncWrapperService._handleDataConflict acts on
   * it, inside the same sync session. A background sync only offers the
   * dialog through a snack whose button runs a user-triggered sync, which
   * opens the dialog if it stops again; the harness answers at the first
   * stop, so it never sees another device upload in between. Unset, the
   * dialog stays unanswered: the device keeps its stop.
   */
  private async _answerStopDialog(
    device: FuzzDevice,
    syncService: OperationLogSyncService,
    session: SyncSessionValidationService,
  ): Promise<void> {
    const answer = this.stopDialogAnswer;
    if (!answer) return;
    this.record(device, 'stop-dialog', answer);
    try {
      if (answer === 'USE_LOCAL') {
        // The app reports UNKNOWN_OR_CHANGED and leaves the rejected ops
        // pending for the next sync; the pending oracle sees any left over.
        await syncService.forceUploadLocalState(device.client);
      } else {
        session.reset();
        await syncService.forceDownloadRemoteState(device.client);
        if (session.hasFailed()) {
          this.record(device, 'validation', 'state invalid after use-remote');
        }
      }
    } catch (e) {
      // The app shows an error snack (FORCE_UPLOAD_FAILED for a force upload).
      const message = e instanceof Error ? e.message : String(e);
      this.record(
        device,
        'sync-error',
        `stop-dialog ${answer} ${(e as Error)?.name}: ${message}`,
      );
    }
  }

  /** Synced state (the snapshot sync ships, archives included). */
  async syncedState(device: FuzzDevice): Promise<AppStateSnapshot> {
    return this.as(device, () =>
      TestBed.inject(StateSnapshotService).getStateSnapshotAsync(),
    );
  }

  async pendingOpCount(device: FuzzDevice): Promise<number> {
    return this.as(
      device,
      async () => (await TestBed.inject(OperationLogStoreService).getUnsynced()).length,
    );
  }
}
