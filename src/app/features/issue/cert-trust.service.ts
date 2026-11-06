import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable, combineLatest } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { IS_ELECTRON } from '../../app.constants';
import { selectEnabledIssueProviders } from './store/issue-provider.selectors';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { getConfiguredHosts } from '../../../../electron/shared-with-frontend/cert-trust-hosts';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { DEFAULT_PLAINSPACE_CFG } from './providers/plainspace/plainspace-cfg-form.const';

// Providers' public default servers are form defaults, not user-chosen hosts.
const DEFAULT_PUBLIC_HOSTS = new Set(
  getConfiguredHosts([DEFAULT_GLOBAL_CONFIG.sync.superSync, DEFAULT_PLAINSPACE_CFG]),
);

/**
 * Tells the Electron main process which hosts may present invalid (e.g.
 * self-signed) certificates: those in enabled issue providers and the active
 * sync provider (WebDAV, Nextcloud, custom SuperSync). #11097
 */
@Injectable({ providedIn: 'root' })
export class CertTrustService {
  private _store = inject(Store);
  private _providerManager = inject(SyncProviderManager);
  private _destroyRef = inject(DestroyRef);

  /** Sorted hosts of all configured provider URLs; emits only on change. */
  readonly trustedHosts$: Observable<string[]> = combineLatest([
    this._store.select(selectEnabledIssueProviders),
    this._providerManager.currentProviderPrivateCfg$,
  ]).pipe(
    map(([issueProviders, syncCfg]) =>
      getConfiguredHosts([...issueProviders, syncCfg?.privateCfg])
        .filter((host) => !DEFAULT_PUBLIC_HOSTS.has(host))
        .sort(),
    ),
    distinctUntilChanged((a, b) => a.join() === b.join()),
  );

  /** Call from trusted startup code: the preload API is one-shot so plugins can't claim it. */
  init(): void {
    const api = IS_ELECTRON ? window.ea.consumeCertTrustApi() : null;
    if (!api) {
      return;
    }
    this.trustedHosts$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((hosts) => api.setTrustedHosts(hosts));
  }
}
