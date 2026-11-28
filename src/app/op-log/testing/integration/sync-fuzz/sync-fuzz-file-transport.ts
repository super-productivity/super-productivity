import { EnvironmentInjector, Injector, runInInjectionContext } from '@angular/core';
import { GlobalConfigService } from '../../../../features/config/global-config.service';
import { FileBasedSyncAdapterService } from '../../../sync-providers/file-based/file-based-sync-adapter.service';
import {
  OperationSyncCapable,
  OpUploadResponse,
  SnapshotUploadResponse,
  SyncOperation,
} from '../../../sync-providers/provider.interface';
import { SyncProviderId } from '../../../sync-providers/provider.const';
import { MockFileProvider } from '../helpers/mock-file-provider.helper';
import { StoredOperation } from './fake-super-sync-server';

/**
 * Transport of a fuzz run that syncs through the real FileBasedSyncAdapterService
 * (Dropbox / WebDAV / OneDrive / LocalFile code path) on an in-memory file
 * provider, instead of the fake SuperSync server.
 *
 * `split` is the opt-in v3 split-file format (isUseSplitSyncFiles); the
 * default is the v2 single sync-data.json. The provider honours revToMatch
 * (Dropbox, OneDrive, WebDAV If-Match); one that ignores it would behave the
 * same here, because the harness never lets two uploads race.
 */
export interface FileTransportOptions {
  split?: boolean;
  /**
   * Whose rules the adapter applies (default WebDAV). Dropbox and OneDrive add
   * the cheap rev pre-check that skips the download of an unchanged file.
   */
  providerId?: SyncProviderId;
}

/** Thrown by every durable write of a device the harness has killed mid-sync. */
export class FuzzKillError extends Error {
  override name = 'FuzzKillError';
}

// The one key FileBasedSyncAdapterService persists its cursor state under.
const ADAPTER_STATE_KEY = 'FILE_SYNC_VERSION_state';

/** What the runner reads from the "server": the ops and snapshots that reached the wire. */
export interface TransportLog {
  readonly rows: StoredOperation[];
  readonly rejections: { errorCode: string; actionType: string }[];
  readonly latestSeq: number;
}

export class FileTransport {
  readonly provider: MockFileProvider;
  readonly log: TransportLog;
  private readonly _rows: StoredOperation[] = [];
  private readonly _rejections: TransportLog['rejections'] = [];
  // An accepted upload or snapshot moves the file; a download does not.
  private _writes = 0;
  /**
   * Called before every durable write of the syncing device's adapter (remote
   * upload or removal, cursor state), and again once an upload has landed; a
   * throw fails the write, or loses the response of a landed upload.
   */
  writeGate?: () => void;
  /** Whether an upload reached the sync file since the harness last reset this. */
  hasLanded = false;
  // Uploads that reached the sync file, to tell whether one adapter call's did.
  private _landings = 0;
  private readonly _clients = new WeakMap<
    OperationSyncCapable,
    { injector: EnvironmentInjector; durable: { state: string | null } }
  >();

  constructor(private readonly _options: FileTransportOptions = {}) {
    this.provider = new MockFileProvider(_options.providerId ?? SyncProviderId.WebDAV);
    const upload = this.provider.uploadFile.bind(this.provider);
    this.provider.uploadFile = async (...args) => {
      this.writeGate?.();
      const response = await upload(...args);
      // The backup copy is written first and holds no new ops.
      // shortcut: any other file counts for the whole upload — track files
      // separately if kills are ever run with `split`.
      if (!args[0].endsWith('.bak')) {
        this.hasLanded = true;
        this._landings++;
      }
      this.writeGate?.();
      return response;
    };
    const remove = this.provider.removeFile.bind(this.provider);
    this.provider.removeFile = async (...args) => {
      this.writeGate?.();
      return remove(...args);
    };
    const writes = (): number => this._writes;
    this.log = {
      rows: this._rows,
      rejections: this._rejections,
      get latestSeq() {
        return writes();
      },
    };
  }

  /**
   * One device's adapter: an own adapter service (it keeps the device's
   * expected sync version, rev and cursor, as each app instance does), over
   * the shared provider. The service persists its cursor state to one
   * localStorage key; clearing it first stops a new device inheriting another's.
   */
  createClient(injector: EnvironmentInjector): OperationSyncCapable {
    return this._createClient(injector, null);
  }

  /**
   * The adapter of `client`'s device after an app restart: a new adapter
   * service that loads the cursor state the old one last persisted.
   */
  reloadClient(client: OperationSyncCapable): OperationSyncCapable {
    const known = this._clients.get(client);
    if (!known) throw new Error('SyncFuzz: not a client of this file transport');
    return this._createClient(known.injector, known.durable.state);
  }

  private _createClient(
    injector: EnvironmentInjector,
    persistedState: string | null,
  ): OperationSyncCapable {
    const config = {
      sync: () => ({ isUseSplitSyncFiles: this._options.split === true }),
    } as unknown as GlobalConfigService;
    const scoped = Injector.create({
      providers: [{ provide: GlobalConfigService, useValue: config }],
      parent: injector,
    });
    this._clearPersistedAdapterState();
    if (persistedState !== null) localStorage.setItem(ADAPTER_STATE_KEY, persistedState);
    const service = runInInjectionContext(
      scoped as EnvironmentInjector,
      () => new FileBasedSyncAdapterService(),
    );
    // Devices share localStorage, so what each adapter persisted is kept here.
    const durable = { state: persistedState };
    const internals = service as unknown as { _persistState: () => void };
    const persist = internals._persistState.bind(service);
    internals._persistState = () => {
      this.writeGate?.();
      persist();
      durable.state = localStorage.getItem(ADAPTER_STATE_KEY);
    };
    const adapter = service.createAdapter(
      this.provider,
      { isEncrypt: false, isCompress: false },
      undefined,
    );
    this._clearPersistedAdapterState();
    const client = this._recording(adapter);
    this._clients.set(client, { injector, durable });
    return client;
  }

  private _clearPersistedAdapterState(): void {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('FILE_SYNC_VERSION_')) localStorage.removeItem(key);
    }
  }

  private _record(op: SyncOperation): void {
    this._rows.push({
      serverSeq: this._rows.length + 1,
      receivedAt: Date.now(),
      clientTimestamp: op.timestamp,
      op,
    });
  }

  private _recordUpload(ops: SyncOperation[], response: OpUploadResponse): void {
    for (const result of response.results) {
      const op = ops.find((o) => o.id === result.opId);
      if (result.accepted && op) {
        this._writes++;
        this._record(op);
      } else if (!result.accepted) {
        this._rejections.push({
          errorCode: result.errorCode ?? 'UNKNOWN',
          actionType: op?.actionType ?? '?',
        });
      }
    }
  }

  private _recording(adapter: OperationSyncCapable): OperationSyncCapable {
    return {
      ...adapter,
      uploadOps: async (ops, ...rest) => {
        const landingsBefore = this._landings;
        try {
          const response = await adapter.uploadOps(ops, ...rest);
          this._recordUpload(ops, response);
          return response;
        } catch (e) {
          // Killed between the upload landing and its response: the ops are
          // in the file although the device never learned it.
          if (e instanceof FuzzKillError && this._landings > landingsBefore) {
            this._recordUpload(ops, {
              results: ops.map((op) => ({ opId: op.id, accepted: true })),
            } as OpUploadResponse);
          }
          throw e;
        }
      },
      uploadSnapshot: async (state, clientId, reason, vectorClock, ...rest) => {
        const [schemaVersion, , opId, , opType] = rest;
        const recordAccepted = (): void => {
          this._writes++;
          // Only a snapshot with an op type replaces state the oracles must know of.
          if (!opType) return;
          this._record({
            id: opId,
            clientId,
            actionType: 'SnapshotUpload',
            opType,
            entityType: 'ALL',
            payload: structuredClone(state),
            vectorClock,
            timestamp: Date.now(),
            schemaVersion,
          } as SyncOperation);
        };
        const landingsBefore = this._landings;
        try {
          const response: SnapshotUploadResponse = await adapter.uploadSnapshot!(
            state,
            clientId,
            reason,
            vectorClock,
            ...rest,
          );
          if (response.accepted) recordAccepted();
          return response;
        } catch (e) {
          // As for uploadOps: the snapshot is in the file.
          if (e instanceof FuzzKillError && this._landings > landingsBefore) {
            recordAccepted();
          }
          throw e;
        }
      },
    } as OperationSyncCapable;
  }
}
