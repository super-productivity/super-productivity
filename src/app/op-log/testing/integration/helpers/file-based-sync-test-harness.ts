import { runInInjectionContext, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MockFileProvider } from './mock-file-provider.helper';
import { FileBasedSyncAdapterService } from '../../../sync-providers/file-based/file-based-sync-adapter.service';
import {
  OperationSyncCapable,
  SyncOperation,
  OpUploadResponse,
  OpDownloadResponse,
} from '../../../sync-providers/provider.interface';
import { SyncProviderId } from '../../../sync-providers/provider.const';
import { EncryptAndCompressCfg } from '../../../core/types/sync.types';
import { TestClient } from './test-client.helper';
import { VectorClock } from '../../../core/operation.types';
import { v4 as uuidV4 } from 'uuid';
import { ArchiveDbAdapter } from '../../../../core/persistence/archive-db-adapter.service';
import { StateSnapshotService } from '../../../backup/state-snapshot.service';

/**
 * A simulated client in the test harness.
 * Has its own adapter instance but shares the MockFileProvider with other clients.
 */
export interface HarnessClient {
  /** Unique client ID */
  clientId: string;

  /** The operation sync adapter for this client */
  adapter: OperationSyncCapable;

  /** Test client for vector clock management */
  testClient: TestClient;

  /** Upload operations to the shared provider */
  uploadOps(ops: SyncOperation[]): Promise<OpUploadResponse>;

  /** Download operations from the shared provider */
  downloadOps(sinceSeq?: number): Promise<OpDownloadResponse>;

  /** Create an operation with proper vector clock */
  createOp(
    entityType: string,
    entityId: string,
    opType: string,
    actionType: string,
    payload: unknown,
  ): SyncOperation;

  /** Get current vector clock for this client */
  getCurrentClock(): VectorClock;

  /** Merge a remote vector clock into this client's knowledge */
  mergeRemoteClock(remoteClock: VectorClock): void;
}

/**
 * Configuration for the test harness.
 */
export interface HarnessConfig {
  /** Provider ID to use (defaults to WebDAV) */
  providerId?: SyncProviderId;

  /** Encryption config (defaults to no encryption) */
  encryptAndCompressCfg?: EncryptAndCompressCfg;

  /** Encryption key (undefined = no encryption) */
  encryptKey?: string;
}

/**
 * Mock ArchiveDbAdapter for tests - stores archives in memory.
 */
class MockArchiveDbAdapter {
  private _archiveYoung: unknown = null;
  private _archiveOld: unknown = null;

  async loadArchiveYoung(): Promise<unknown> {
    return this._archiveYoung;
  }

  async loadArchiveOld(): Promise<unknown> {
    return this._archiveOld;
  }

  async saveArchiveYoung(data: unknown): Promise<void> {
    this._archiveYoung = data;
  }

  async saveArchiveOld(data: unknown): Promise<void> {
    this._archiveOld = data;
  }

  reset(): void {
    this._archiveYoung = null;
    this._archiveOld = null;
  }
}

/**
 * Mock StateSnapshotService for tests - returns configurable state.
 */
class MockStateSnapshotService {
  private _state: unknown = { task: { ids: [], entities: {} } };

  async getStateSnapshot(): Promise<unknown> {
    return this._state;
  }

  setState(state: unknown): void {
    this._state = state;
  }

  reset(): void {
    this._state = { task: { ids: [], entities: {} } };
  }
}

/**
 * Test harness for simulating multi-client file-based sync scenarios.
 *
 * Creates isolated clients that share a MockFileProvider (simulating shared remote storage).
 * Each client has its own:
 * - FileBasedSyncAdapterService instance
 * - TestClient (for vector clock management)
 * - Local knowledge of processed operations
 *
 * ## Architecture
 * ```
 * ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
 * │  Client A   │     │  Client B   │     │  Client C   │
 * │  (adapter)  │     │  (adapter)  │     │  (adapter)  │
 * └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
 *        │                   │                   │
 *        └───────────────────┼───────────────────┘
 *                            │
 *                   ┌────────┴────────┐
 *                   │ MockFileProvider │
 *                   │  (shared remote) │
 *                   └─────────────────┘
 * ```
 *
 * ## Usage
 * ```typescript
 * const harness = new FileBasedSyncTestHarness();
 *
 * // Create clients
 * const clientA = harness.createClient('client-a');
 * const clientB = harness.createClient('client-b');
 *
 * // Client A creates and uploads an operation
 * const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', { title: 'Test' });
 * await clientA.uploadOps([op]);
 *
 * // Client B downloads
 * const response = await clientB.downloadOps(0);
 * expect(response.ops.length).toBe(1);
 *
 * // Cleanup
 * harness.reset();
 * ```
 */
export class FileBasedSyncTestHarness {
  /** The shared mock provider (simulates remote storage) */
  private _provider: MockFileProvider;

  /** Map of client ID to HarnessClient */
  private _clients = new Map<string, HarnessClient>();

  /** Configuration for this harness */
  private _config: Required<HarnessConfig>;

  /** Mock archive adapter shared across clients */
  private _mockArchiveDb: MockArchiveDbAdapter;

  /** Mock state snapshot service shared across clients */
  private _mockStateSnapshot: MockStateSnapshotService;

  /** Parent injector from TestBed */
  private _parentInjector: EnvironmentInjector;

  /**
   * Creates and configures a test harness.
   *
   * IMPORTANT: Call this BEFORE TestBed.inject() to ensure providers are properly configured.
   * Use the static factory method `create()` for proper TestBed configuration.
   */
  constructor(config: HarnessConfig = {}, parentInjector?: EnvironmentInjector) {
    this._config = {
      providerId: config.providerId ?? SyncProviderId.WebDAV,
      encryptAndCompressCfg: config.encryptAndCompressCfg ?? {
        isCompressionEnabled: false,
        encryptionMethod: 'none',
      },
      encryptKey: config.encryptKey ?? undefined,
    } as Required<HarnessConfig>;

    this._provider = new MockFileProvider(this._config.providerId);
    this._mockArchiveDb = new MockArchiveDbAdapter();
    this._mockStateSnapshot = new MockStateSnapshotService();

    // Store the parent injector for use in _createAdapterService
    this._parentInjector = parentInjector!;
  }

  /**
   * Factory method that properly configures TestBed with mock providers.
   * Use this instead of calling the constructor directly.
   *
   * @example
   * ```typescript
   * beforeEach(() => {
   *   harness = FileBasedSyncTestHarness.create({});
   * });
   * ```
   */
  static create(config: HarnessConfig = {}): FileBasedSyncTestHarness {
    // Create mock instances that will be shared
    const mockArchiveDb = new MockArchiveDbAdapter();
    const mockStateSnapshot = new MockStateSnapshotService();

    // Configure TestBed with mock providers BEFORE inject() is called
    TestBed.configureTestingModule({
      providers: [
        { provide: ArchiveDbAdapter, useValue: mockArchiveDb },
        { provide: StateSnapshotService, useValue: mockStateSnapshot },
      ],
    });

    // Now we can safely inject the environment injector
    const parentInjector = TestBed.inject(EnvironmentInjector);

    // Create harness instance
    const harness = new FileBasedSyncTestHarness(config, parentInjector);

    // Share the mock instances with the harness
    harness._mockArchiveDb = mockArchiveDb;
    harness._mockStateSnapshot = mockStateSnapshot;

    return harness;
  }

  /**
   * Creates a simulated client with its own adapter instance.
   * All clients share the same MockFileProvider (remote storage).
   *
   * @param clientId Unique identifier for this client
   * @returns A HarnessClient that can upload/download operations
   */
  createClient(clientId: string): HarnessClient {
    if (this._clients.has(clientId)) {
      throw new Error(`Client ${clientId} already exists`);
    }

    // Create a fresh adapter service for this client
    // Each client needs its own adapter service instance because:
    // - _processedOpIds tracks what THIS client has seen (not global)
    // - _expectedSyncVersions tracks what THIS client expects
    // In real usage, each app instance has its own adapter service
    const adapterService = this._createAdapterService();

    const testClient = new TestClient(clientId);

    // Create adapter for this client using the shared provider
    const adapter = adapterService.createAdapter(
      this._provider,
      this._config.encryptAndCompressCfg,
      this._config.encryptKey,
    );

    // Track last known server seq for this client
    let lastKnownSeq = 0;

    const client: HarnessClient = {
      clientId,
      adapter,
      testClient,

      uploadOps: async (ops: SyncOperation[]): Promise<OpUploadResponse> => {
        const response = await adapter.uploadOps(ops, clientId, lastKnownSeq);
        lastKnownSeq = response.latestSeq;
        return response;
      },

      downloadOps: async (sinceSeq?: number): Promise<OpDownloadResponse> => {
        const seq = sinceSeq ?? lastKnownSeq;
        const response = await adapter.downloadOps(seq, clientId);
        lastKnownSeq = response.latestSeq;
        return response;
      },

      createOp: (
        entityType: string,
        entityId: string,
        opType: string,
        actionType: string,
        payload: unknown,
      ): SyncOperation => {
        // Increment vector clock for this operation (manually, as TestClient.createOperation
        // does this internally but we need SyncOperation format)
        const currentClock = testClient.getCurrentClock();
        currentClock[clientId] = (currentClock[clientId] || 0) + 1;
        testClient.setVectorClock(currentClock);

        return {
          id: uuidV4(),
          clientId,
          actionType,
          opType,
          entityType,
          entityId,
          payload,
          vectorClock: { ...currentClock },
          timestamp: Date.now(),
          schemaVersion: 1,
        };
      },

      getCurrentClock: (): VectorClock => {
        return testClient.getCurrentClock();
      },

      mergeRemoteClock: (remoteClock: VectorClock): void => {
        testClient.mergeRemoteClock(remoteClock);
      },
    };

    this._clients.set(clientId, client);
    return client;
  }

  /**
   * Gets the shared mock provider for direct manipulation/assertions.
   */
  getProvider(): MockFileProvider {
    return this._provider;
  }

  /**
   * Gets an existing client by ID.
   */
  getClient(clientId: string): HarnessClient | undefined {
    return this._clients.get(clientId);
  }

  /**
   * Sets the mock state that will be returned by StateSnapshotService.
   * Call this before uploadOps to control what state gets written to the sync file.
   */
  setMockState(state: unknown): void {
    this._mockStateSnapshot.setState(state);
  }

  /**
   * Sets mock archive data.
   */
  async setMockArchive(young: unknown, old: unknown): Promise<void> {
    await this._mockArchiveDb.saveArchiveYoung(young);
    await this._mockArchiveDb.saveArchiveOld(old);
  }

  /**
   * Simulates Client A uploading ops, then Client B downloading them.
   * Convenience method for common A→B sync pattern.
   *
   * @returns The download response from Client B
   */
  async syncAtoB(
    clientAId: string,
    clientBId: string,
    ops: SyncOperation[],
  ): Promise<OpDownloadResponse> {
    const clientA = this._clients.get(clientAId);
    const clientB = this._clients.get(clientBId);

    if (!clientA || !clientB) {
      throw new Error(`Client(s) not found: ${clientAId}, ${clientBId}`);
    }

    // Client A uploads
    await clientA.uploadOps(ops);

    // Client B downloads (from seq 0 to get all ops)
    return clientB.downloadOps(0);
  }

  /**
   * Resets all state for test isolation.
   * Call this in afterEach() to ensure clean state between tests.
   */
  reset(): void {
    this._provider.reset();
    this._clients.clear();
    this._mockArchiveDb.reset();
    this._mockStateSnapshot.reset();
    // Clear localStorage keys used by FileBasedSyncAdapterService
    this._clearLocalStorage();
  }

  /**
   * Creates a fresh adapter service instance with mocked dependencies.
   * Each client needs its own instance to properly simulate independent app instances.
   *
   * Uses runInInjectionContext to allow Angular's inject() to work properly
   * while providing our mocked dependencies via TestBed.overrideProvider.
   */
  private _createAdapterService(): FileBasedSyncAdapterService {
    // Create service within injection context so inject() works
    // The providers have been overridden in TestBed, so inject() will resolve to our mocks
    return runInInjectionContext(this._parentInjector, () => {
      return new FileBasedSyncAdapterService();
    });
  }

  /**
   * Clears localStorage keys used by FileBasedSyncAdapterService.
   */
  private _clearLocalStorage(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('FILE_SYNC_VERSION_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  }
}

/**
 * Creates a minimal valid SyncOperation for testing.
 */
export const createTestSyncOperation = (
  clientId: string,
  entityType: string,
  entityId: string,
  opType: string,
  payload: unknown,
  vectorClock: VectorClock = {},
): SyncOperation => ({
  id: uuidV4(),
  clientId,
  actionType: 'TestAction',
  opType,
  entityType,
  entityId,
  payload,
  vectorClock: { [clientId]: 1, ...vectorClock },
  timestamp: Date.now(),
  schemaVersion: 1,
});
