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

  constructor(private readonly _options: FileTransportOptions = {}) {
    this.provider = new MockFileProvider(_options.providerId ?? SyncProviderId.WebDAV);
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
    const config = {
      sync: () => ({ isUseSplitSyncFiles: this._options.split === true }),
    } as unknown as GlobalConfigService;
    const scoped = Injector.create({
      providers: [{ provide: GlobalConfigService, useValue: config }],
      parent: injector,
    });
    this._clearPersistedAdapterState();
    const service = runInInjectionContext(
      scoped as EnvironmentInjector,
      () => new FileBasedSyncAdapterService(),
    );
    const adapter = service.createAdapter(
      this.provider,
      { isEncrypt: false, isCompress: false },
      undefined,
    );
    this._clearPersistedAdapterState();
    return this._recording(adapter);
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
        const response = await adapter.uploadOps(ops, ...rest);
        this._recordUpload(ops, response);
        return response;
      },
      uploadSnapshot: async (state, clientId, reason, vectorClock, ...rest) => {
        const [schemaVersion, , opId, , opType] = rest;
        const response: SnapshotUploadResponse = await adapter.uploadSnapshot!(
          state,
          clientId,
          reason,
          vectorClock,
          ...rest,
        );
        if (response.accepted) this._writes++;
        // Only a snapshot with an op type replaces state the oracles must know of.
        if (response.accepted && opType) {
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
        }
        return response;
      },
    } as OperationSyncCapable;
  }
}
