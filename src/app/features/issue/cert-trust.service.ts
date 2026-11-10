import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { BehaviorSubject, Observable, combineLatest } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { IS_ELECTRON } from '../../app.constants';
import { selectEnabledIssueProviders } from './store/issue-provider.selectors';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import {
  CertTrustElectronApi,
  getConfiguredHosts,
} from '../../../../electron/shared-with-frontend/cert-trust-hosts';
import { IssueLog } from '../../core/log';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { DEFAULT_PLAINSPACE_CFG } from './providers/plainspace/plainspace-cfg-form.const';

// Providers' public default servers are form defaults, not user-chosen hosts.
const DEFAULT_PUBLIC_HOSTS = new Set(
  getConfiguredHosts([DEFAULT_GLOBAL_CONFIG.sync.superSync, DEFAULT_PLAINSPACE_CFG]),
);

/**
 * Tells the Electron main process which hosts may present invalid (e.g.
 * self-signed) certificates: those in enabled issue providers, the active
 * sync provider (WebDAV, Nextcloud, custom SuperSync) and configs a provider
 * dialog is currently testing (see `setPendingConfig`). #11097
 */
@Injectable({ providedIn: 'root' })
export class CertTrustService {
  private _store = inject(Store);
  private _providerManager = inject(SyncProviderManager);
  private _destroyRef = inject(DestroyRef);
  private _pendingCfgs$ = new BehaviorSubject<ReadonlyMap<object, unknown>>(new Map());
  private _lastUpdate: Promise<void> = Promise.resolve();

  /** Sorted hosts of all configured provider URLs; emits only on change. */
  readonly trustedHosts$: Observable<string[]> = combineLatest([
    this._store.select(selectEnabledIssueProviders),
    this._providerManager.currentProviderPrivateCfg$,
    this._pendingCfgs$,
  ]).pipe(
    map(([issueProviders, syncCfg, pendingCfgs]) =>
      getConfiguredHosts([
        ...issueProviders,
        syncCfg?.privateCfg,
        ...pendingCfgs.values(),
      ])
        .filter((host) => !DEFAULT_PUBLIC_HOSTS.has(host))
        .sort(),
    ),
    distinctUntilChanged((a, b) => a.join() === b.join()),
  );

  /** Call from trusted startup code: the preload API is one-shot so plugins can't claim it. */
  init(
    api: CertTrustElectronApi | null = IS_ELECTRON
      ? window.ea.consumeCertTrustApi()
      : null,
  ): void {
    if (!api) {
      return;
    }
    this.trustedHosts$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((hosts) => this._send(api, hosts));
  }

  /**
   * Also trusts the hosts of a not yet saved (or disabled) config, so a
   * provider dialog can test it, until cleared with `null` (on dialog close).
   * Resolves once the main process has the resulting list, so a request sent
   * afterwards is covered. Only reachable via DI, not from the plugin API.
   */
  setPendingConfig(owner: object, cfg: unknown): Promise<void> {
    const next = new Map(this._pendingCfgs$.value);
    if (cfg === null) {
      next.delete(owner);
    } else {
      next.set(owner, cfg);
    }
    // trustedHosts$ emits synchronously, so _lastUpdate covers this change
    // (or is the still-current update if the host list didn't change).
    this._pendingCfgs$.next(next);
    return this._lastUpdate;
  }

  private _send(api: CertTrustElectronApi, hosts: string[]): void {
    this._lastUpdate = api.setTrustedHosts(hosts).catch((e) => {
      IssueLog.err('Failed to update trusted certificate hosts', e);
    });
  }
}
