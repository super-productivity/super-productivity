import { inject, InjectionToken } from '@angular/core';
import { ClientIdService } from '../../core/util/client-id.service';

/**
 * Interface for providing the sync client ID.
 *
 * This abstraction breaks the circular dependency between operation-log services
 * and PfapiService. Previously, services like OperationLogSyncService,
 * ConflictResolutionService, and ServerMigrationService used lazyInject()
 * to get PfapiService just for the client ID.
 *
 * By injecting this token instead, the dependency graph is cleaner:
 * - Operation-log services depend on CLIENT_ID_PROVIDER (a simple interface)
 * - CLIENT_ID_PROVIDER delegates to ClientIdService
 * - ClientIdService handles lazy PfapiService resolution
 */
export interface ClientIdProvider {
  /**
   * Returns the stored client ID, or null if none exists (or a read failed).
   *
   * SIDE EFFECT: the first read of a device that still has its clientId only
   * in the legacy 'pf' database copies it forward into SUP_OPS (one-time,
   * idempotent migration — see ClientIdService). All later reads are cached.
   */
  loadClientId(): Promise<string | null>;
  /**
   * Returns the stored client ID, or generates and persists a new one if
   * none is stored. Preferred over calling loadClientId() with a manual
   * fallback. Propagates IndexedDB read failures (it must never mint a fresh
   * id on a transient error — that would orphan the device's real identity).
   */
  getOrGenerateClientId(): Promise<string>;
  /**
   * Invalidates the in-memory clientId cache so the next read re-resolves
   * from IndexedDB. Called by runDestructiveStateReplacement after it rotates
   * the clientId inside the atomic SUP_OPS transaction.
   */
  clearCache(): void;
}

/**
 * Injection token for the client ID provider.
 *
 * Delegates to ClientIdService which handles lazy injection and caching.
 *
 * Usage:
 * ```typescript
 * private clientIdProvider = inject(CLIENT_ID_PROVIDER);
 * // ...
 * const clientId = await this.clientIdProvider.getOrGenerateClientId();
 * ```
 */
export const CLIENT_ID_PROVIDER = new InjectionToken<ClientIdProvider>(
  'CLIENT_ID_PROVIDER',
  {
    providedIn: 'root',
    factory: () => {
      const clientIdService = inject(ClientIdService);
      return {
        loadClientId: () => clientIdService.loadClientId(),
        getOrGenerateClientId: () => clientIdService.getOrGenerateClientId(),
        clearCache: () => clientIdService.clearCache(),
      };
    },
  },
);
