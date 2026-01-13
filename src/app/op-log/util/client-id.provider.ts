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
  loadClientId(): Promise<string | null>;
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
 * const clientId = await this.clientIdProvider.loadClientId();
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
      };
    },
  },
);
