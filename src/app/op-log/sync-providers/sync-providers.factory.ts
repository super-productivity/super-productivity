import { SyncProviderId } from './provider.const';
import { SyncProviderBase } from './provider.interface';
import { DROPBOX_APP_KEY } from '../../imex/sync/dropbox/dropbox.const';
import { IS_ELECTRON } from '../../app.constants';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { environment } from '../../../environments/environment';

let _providersPromise: Promise<SyncProviderBase<SyncProviderId>[]> | null = null;

/**
 * Lazily loads and instantiates all sync providers.
 * Provider modules (Dropbox, WebDAV, SuperSync, LocalFile) are only imported
 * when this function is first called, keeping them out of the initial bundle.
 */
export const loadSyncProviders = (): Promise<SyncProviderBase<SyncProviderId>[]> => {
  if (!_providersPromise) {
    _providersPromise = _createProviders().catch((err) => {
      _providersPromise = null;
      throw err;
    });
  }
  return _providersPromise;
};

/**
 * Narrow interface for LocalFile sync providers that expose directory picker methods.
 * Used to avoid `as any` casts in sync-form.const.ts.
 */
export interface LocalFileSyncPicker {
  pickDirectory(): Promise<string | void>;
  setupSaf(): Promise<string>;
}

const _createProviders = async (): Promise<SyncProviderBase<SyncProviderId>[]> => {
  const [{ Dropbox }, { Webdav }, { SuperSyncProvider }, { NextcloudProvider }] =
    await Promise.all([
      import('./file-based/dropbox/dropbox'),
      import('./file-based/webdav/webdav'),
      import('./super-sync/super-sync'),
      import('./file-based/webdav/nextcloud'),
    ]);

  const providers: SyncProviderBase<SyncProviderId>[] = [
    new Dropbox({
      appKey: DROPBOX_APP_KEY,
      basePath: environment.production ? `/` : `/DEV/`,
    }) as SyncProviderBase<SyncProviderId>,
    new Webdav(
      environment.production ? undefined : `/DEV`,
    ) as SyncProviderBase<SyncProviderId>,
    new SuperSyncProvider(
      environment.production ? undefined : `/DEV`,
    ) as SyncProviderBase<SyncProviderId>,
    new NextcloudProvider(
      environment.production ? undefined : `/DEV`,
    ) as SyncProviderBase<SyncProviderId>,
  ];

  if (IS_ELECTRON) {
    const { LocalFileSyncElectron } =
      await import('./file-based/local-file/local-file-sync-electron');
    providers.push(new LocalFileSyncElectron() as SyncProviderBase<SyncProviderId>);
  }

  if (IS_ANDROID_WEB_VIEW) {
    const { LocalFileSyncAndroid } =
      await import('./file-based/local-file/local-file-sync-android');
    providers.push(new LocalFileSyncAndroid() as SyncProviderBase<SyncProviderId>);
  }

  return providers;
};
