import {
  SyncProviderServiceInterface,
  FileRevResponse,
  FileDownloadResponse,
} from '../../../sync-providers/provider.interface';
import { SyncProviderId } from '../../../sync-providers/provider.const';
import { SyncCredentialStore } from '../../../sync-providers/credential-store.service';
import {
  RemoteFileNotFoundAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../../../core/errors/sync-errors';
import { PrivateCfgByProviderId } from '../../../core/types/sync.types';

/**
 * Call record for tracking provider method invocations.
 */
export interface MockProviderCall {
  method: 'getFileRev' | 'downloadFile' | 'uploadFile' | 'removeFile' | 'isReady';
  args: unknown[];
  timestamp: number;
}

/**
 * In-memory file storage entry.
 */
interface StoredFile {
  data: string;
  rev: string;
}

/**
 * Creates a mock credential store for testing.
 * Returns an object that satisfies the SyncCredentialStore interface.
 */
const createMockCredentialStore = <
  PID extends SyncProviderId,
>(): SyncCredentialStore<PID> => {
  let cfg: PrivateCfgByProviderId<PID> | null = null;

  return {
    load: async () => cfg,
    setComplete: async (newCfg: PrivateCfgByProviderId<PID>) => {
      cfg = newCfg;
    },
    updatePartial: async (updates: Partial<PrivateCfgByProviderId<PID>>) => {
      cfg = { ...cfg, ...updates } as PrivateCfgByProviderId<PID>;
    },
    upsertPartial: async (updates: Partial<PrivateCfgByProviderId<PID>>) => {
      cfg = cfg
        ? ({ ...cfg, ...updates } as PrivateCfgByProviderId<PID>)
        : (updates as PrivateCfgByProviderId<PID>);
    },
    clear: async () => {
      cfg = null;
    },
    onConfigChange: () => {
      // No-op for tests
    },
  } as unknown as SyncCredentialStore<PID>;
};

/**
 * Mock implementation of SyncProviderServiceInterface for integration testing.
 *
 * Simulates a file-based storage (like Dropbox/WebDAV) by storing data in memory.
 * This allows testing FileBasedSyncAdapterService without real network calls.
 *
 * ## Key Features
 * - In-memory file storage with automatic revision tracking
 * - Simulates ETag-based conditional uploads (revToMatch)
 * - Error injection for testing failure paths
 * - Call history tracking for assertions
 * - Configurable latency for race condition testing
 *
 * ## Usage
 * ```typescript
 * const provider = new MockFileProvider(SyncProviderId.WebDAV);
 *
 * // Pre-populate with test data
 * provider.setFileContent('sync-data.json', JSON.stringify(testData));
 *
 * // Use with FileBasedSyncAdapterService
 * const adapter = adapterService.createAdapter(provider, cfg, undefined);
 *
 * // Assert on calls
 * expect(provider.getCallHistory()).toContain(
 *   jasmine.objectContaining({ method: 'uploadFile' })
 * );
 * ```
 */
export class MockFileProvider implements SyncProviderServiceInterface<SyncProviderId> {
  readonly id: SyncProviderId;
  readonly isUploadForcePossible = true;
  readonly maxConcurrentRequests = 4;
  readonly privateCfg: SyncCredentialStore<SyncProviderId>;

  /** In-memory file storage: path -> { data, rev } */
  private _files = new Map<string, StoredFile>();

  /** Auto-incrementing revision counter */
  private _revCounter = 0;

  /** Call history for assertions */
  private _callHistory: MockProviderCall[] = [];

  /** Next error to throw (consumed on use) */
  private _nextError: Error | null = null;

  /** Error to throw on specific method */
  private _methodErrors = new Map<string, Error>();

  /** Simulated network latency in ms */
  private _latencyMs = 0;

  /** Whether provider is "ready" (authenticated) */
  private _isReady = true;

  constructor(id: SyncProviderId = SyncProviderId.WebDAV) {
    this.id = id;
    this.privateCfg = createMockCredentialStore();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNC PROVIDER INTERFACE IMPLEMENTATION
  // ═══════════════════════════════════════════════════════════════════════════

  async getFileRev(
    targetPath: string,
    localRev: string | null,
  ): Promise<FileRevResponse> {
    this._recordCall('getFileRev', [targetPath, localRev]);
    await this._applyLatency();
    this._checkForError('getFileRev');

    const file = this._files.get(targetPath);
    if (!file) {
      throw new RemoteFileNotFoundAPIError(`File not found: ${targetPath}`);
    }

    return { rev: file.rev };
  }

  async downloadFile(targetPath: string): Promise<FileDownloadResponse> {
    this._recordCall('downloadFile', [targetPath]);
    await this._applyLatency();
    this._checkForError('downloadFile');

    const file = this._files.get(targetPath);
    if (!file) {
      throw new RemoteFileNotFoundAPIError(`File not found: ${targetPath}`);
    }

    return {
      rev: file.rev,
      dataStr: file.data,
    };
  }

  async uploadFile(
    targetPath: string,
    dataStr: string,
    revToMatch: string | null,
    isForceOverwrite?: boolean,
  ): Promise<FileRevResponse> {
    this._recordCall('uploadFile', [targetPath, dataStr, revToMatch, isForceOverwrite]);
    await this._applyLatency();
    this._checkForError('uploadFile');

    const existingFile = this._files.get(targetPath);

    // Check revision match (conditional upload) unless force overwrite
    if (!isForceOverwrite && revToMatch !== null) {
      if (!existingFile) {
        // File doesn't exist but revToMatch was provided - mismatch
        throw new UploadRevToMatchMismatchAPIError(
          `File ${targetPath} does not exist but revToMatch was provided`,
        );
      }
      if (existingFile.rev !== revToMatch) {
        throw new UploadRevToMatchMismatchAPIError(
          `Rev mismatch for ${targetPath}: expected ${revToMatch}, found ${existingFile.rev}`,
        );
      }
    }

    // Generate new revision
    const newRev = this._generateRev();
    this._files.set(targetPath, { data: dataStr, rev: newRev });

    return { rev: newRev };
  }

  async removeFile(targetPath: string): Promise<void> {
    this._recordCall('removeFile', [targetPath]);
    await this._applyLatency();
    this._checkForError('removeFile');

    if (!this._files.has(targetPath)) {
      throw new RemoteFileNotFoundAPIError(`File not found: ${targetPath}`);
    }

    this._files.delete(targetPath);
  }

  async listFiles(targetPath: string): Promise<string[]> {
    // Simple implementation - list all files that start with targetPath
    const files: string[] = [];
    for (const path of this._files.keys()) {
      if (path.startsWith(targetPath)) {
        files.push(path);
      }
    }
    return files;
  }

  async isReady(): Promise<boolean> {
    this._recordCall('isReady', []);
    return this._isReady;
  }

  async setPrivateCfg(privateCfg: PrivateCfgByProviderId<SyncProviderId>): Promise<void> {
    await this.privateCfg.setComplete(privateCfg);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Pre-populates a file in the mock storage.
   * @returns The assigned revision
   */
  setFileContent(path: string, data: string): string {
    const rev = this._generateRev();
    this._files.set(path, { data, rev });
    return rev;
  }

  /**
   * Gets the current content and revision of a file.
   * @returns File data and rev, or null if not found
   */
  getFileContent(path: string): { data: string; rev: string } | null {
    const file = this._files.get(path);
    return file ? { data: file.data, rev: file.rev } : null;
  }

  /**
   * Checks if a file exists in the mock storage.
   */
  hasFile(path: string): boolean {
    return this._files.has(path);
  }

  /**
   * Injects an error to be thrown on the next call (any method).
   * The error is consumed after being thrown.
   */
  injectNextError(error: Error): void {
    this._nextError = error;
  }

  /**
   * Injects an error to be thrown on a specific method.
   * The error persists until cleared with clearMethodError().
   */
  injectMethodError(
    method: 'getFileRev' | 'downloadFile' | 'uploadFile' | 'removeFile',
    error: Error,
  ): void {
    this._methodErrors.set(method, error);
  }

  /**
   * Clears an error injected for a specific method.
   */
  clearMethodError(
    method: 'getFileRev' | 'downloadFile' | 'uploadFile' | 'removeFile',
  ): void {
    this._methodErrors.delete(method);
  }

  /**
   * Sets simulated network latency.
   */
  setLatency(ms: number): void {
    this._latencyMs = ms;
  }

  /**
   * Sets whether the provider is "ready" (authenticated).
   */
  setReady(ready: boolean): void {
    this._isReady = ready;
  }

  /**
   * Gets the call history for assertions.
   */
  getCallHistory(): MockProviderCall[] {
    return [...this._callHistory];
  }

  /**
   * Gets calls to a specific method.
   */
  getCallsTo(method: MockProviderCall['method']): MockProviderCall[] {
    return this._callHistory.filter((call) => call.method === method);
  }

  /**
   * Clears the call history.
   */
  clearHistory(): void {
    this._callHistory = [];
  }

  /**
   * Resets all state (files, errors, history, latency).
   */
  reset(): void {
    this._files.clear();
    this._revCounter = 0;
    this._callHistory = [];
    this._nextError = null;
    this._methodErrors.clear();
    this._latencyMs = 0;
    this._isReady = true;
  }

  /**
   * Gets the number of files in storage.
   */
  getFileCount(): number {
    return this._files.size;
  }

  /**
   * Gets all file paths in storage.
   */
  getFilePaths(): string[] {
    return Array.from(this._files.keys());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private _generateRev(): string {
    this._revCounter++;
    return `rev-${this._revCounter}-${Date.now()}`;
  }

  private _recordCall(method: MockProviderCall['method'], args: unknown[]): void {
    this._callHistory.push({
      method,
      args,
      timestamp: Date.now(),
    });
  }

  private _checkForError(method: string): void {
    // Check for one-time error first
    if (this._nextError) {
      const error = this._nextError;
      this._nextError = null;
      throw error;
    }

    // Check for persistent method-specific error
    const methodError = this._methodErrors.get(method);
    if (methodError) {
      throw methodError;
    }
  }

  private async _applyLatency(): Promise<void> {
    if (this._latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this._latencyMs));
    }
  }
}

/**
 * Creates a mock provider with pre-configured sync data.
 * Convenience function for common test setup.
 */
export const createMockProviderWithData = (
  id: SyncProviderId,
  syncFilePath: string,
  data: string,
): MockFileProvider => {
  const provider = new MockFileProvider(id);
  provider.setFileContent(syncFilePath, data);
  return provider;
};
