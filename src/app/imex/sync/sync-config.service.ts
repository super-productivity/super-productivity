import { inject, Injectable } from '@angular/core';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { combineLatest, from, Observable, of } from 'rxjs';
import { SyncConfig } from '../../features/config/global-config.model';
import { switchMap, tap } from 'rxjs/operators';
import {
  CurrentProviderPrivateCfg,
  PrivateCfgByProviderId,
  SyncProviderId,
} from '../../op-log/sync-exports';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { SyncLog } from '../../core/log';
import { DerivedKeyCacheService } from '../../op-log/encryption/derived-key-cache.service';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';

// Maps sync providers to their corresponding form field in SyncConfig
// Dropbox is null because it doesn't store settings in the form (uses OAuth)
const PROP_MAP_TO_FORM: Record<SyncProviderId, keyof SyncConfig | null> = {
  [SyncProviderId.LocalFile]: 'localFileSync',
  [SyncProviderId.WebDAV]: 'webDav',
  [SyncProviderId.SuperSync]: 'superSync',
  [SyncProviderId.Dropbox]: null,
};

// Ensures all required fields have empty string defaults to prevent undefined/null errors
// when providers expect string values (e.g., WebDAV API calls fail with undefined URLs)
// Fields that should never be logged, even in development
const SENSITIVE_FIELDS = ['password', 'encryptKey', 'accessToken', 'refreshToken'];

/**
 * Redacts sensitive fields from an object for safe logging.
 * Replaces sensitive values with '[REDACTED]' to prevent credential exposure.
 */
const redactSensitiveFields = (obj: unknown): unknown => {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveFields);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.includes(key)) {
      result[key] = value ? '[REDACTED]' : '';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitiveFields(value);
    } else {
      result[key] = value;
    }
  }
  return result;
};

const PROVIDER_FIELD_DEFAULTS: Record<
  SyncProviderId,
  Record<string, string | boolean>
> = {
  [SyncProviderId.WebDAV]: {
    baseUrl: '',
    userName: '',
    password: '',
    syncFolderPath: '',
    encryptKey: '',
  },
  [SyncProviderId.SuperSync]: {
    baseUrl: '',
    userName: '',
    password: '',
    accessToken: '',
    syncFolderPath: '',
    encryptKey: '',
    isEncryptionEnabled: false,
  },
  [SyncProviderId.LocalFile]: {
    syncFolderPath: '',
    encryptKey: '',
  },
  [SyncProviderId.Dropbox]: {
    encryptKey: '',
  },
};

@Injectable({
  providedIn: 'root',
})
export class SyncConfigService {
  private _providerManager = inject(SyncProviderManager);
  private _globalConfigService = inject(GlobalConfigService);
  private _derivedKeyCache = inject(DerivedKeyCacheService);
  private _wrappedProvider = inject(WrappedProviderService);

  private _lastSettings: SyncConfig | null = null;

  private _deriveEncryptionState(
    baseConfig: SyncConfig,
    currentProviderCfg: CurrentProviderPrivateCfg | null,
  ): { isEncryptionEnabled: boolean; encryptKey: string } {
    if (!currentProviderCfg) {
      return {
        isEncryptionEnabled: baseConfig.isEncryptionEnabled ?? false,
        encryptKey: '',
      };
    }

    const privateCfg = currentProviderCfg.privateCfg as {
      encryptKey?: string;
      isEncryptionEnabled?: boolean;
    } | null;
    if (!privateCfg) {
      return {
        isEncryptionEnabled: baseConfig.isEncryptionEnabled ?? false,
        encryptKey: '',
      };
    }

    const encryptKey = privateCfg.encryptKey ?? '';

    if (currentProviderCfg.providerId === SyncProviderId.SuperSync) {
      return {
        isEncryptionEnabled: privateCfg.isEncryptionEnabled ?? false,
        encryptKey,
      };
    }

    return {
      isEncryptionEnabled: !!encryptKey,
      encryptKey,
    };
  }

  readonly syncSettingsForm$: Observable<SyncConfig> = combineLatest([
    this._globalConfigService.sync$,
    this._providerManager.currentProviderPrivateCfg$,
  ]).pipe(
    switchMap(([syncCfg, currentProviderCfg]) => {
      // Base config with defaults
      // Deep merge provider-specific configs to preserve defaults like superSync.baseUrl
      // Without this, a stored config with superSync: {} would lose the default baseUrl
      const baseConfig = {
        ...DEFAULT_GLOBAL_CONFIG.sync,
        ...syncCfg,
        superSync: {
          ...DEFAULT_GLOBAL_CONFIG.sync.superSync,
          ...syncCfg?.superSync,
        },
        webDav: {
          ...DEFAULT_GLOBAL_CONFIG.sync.webDav,
          ...syncCfg?.webDav,
        },
        localFileSync: {
          ...DEFAULT_GLOBAL_CONFIG.sync.localFileSync,
          ...syncCfg?.localFileSync,
        },
      };

      // If no provider is active, return base config with empty encryption key
      if (!currentProviderCfg) {
        return from(
          fetch('/assets/sync-config-default-override.json')
            .then((res) => res.json())
            .then((defaultOverride) => {
              return {
                ...baseConfig,
                ...defaultOverride,
                webDav: {
                  ...baseConfig.webDav,
                  ...defaultOverride.webDav,
                },
                encryptKey: '',
              };
            })
            .catch((e) => {
              SyncLog.warn(
                'Failed to load sync-config-default-override.json, using base config:',
                e,
              );
              return {
                ...baseConfig,
                encryptKey: '',
              };
            }),
        );
      }

      const prop = PROP_MAP_TO_FORM[currentProviderCfg.providerId];

      const { isEncryptionEnabled, encryptKey } = this._deriveEncryptionState(
        baseConfig,
        currentProviderCfg,
      );

      // Create config with provider-specific settings
      const result: SyncConfig = {
        ...baseConfig,
        encryptKey,
        isEncryptionEnabled,
        // Reset provider-specific configs to defaults first
        localFileSync: DEFAULT_GLOBAL_CONFIG.sync.localFileSync,
        webDav: DEFAULT_GLOBAL_CONFIG.sync.webDav,
        superSync: DEFAULT_GLOBAL_CONFIG.sync.superSync,
      };

      // Add current provider config if applicable
      if (prop && currentProviderCfg.privateCfg) {
        // TypeScript limitation: dynamic key assignment on union types requires cast
        (result as Record<string, unknown>)[prop] = currentProviderCfg.privateCfg;
      }

      return of(result);
    }),
    // Redact sensitive fields (passwords, encryption keys) in all environments
    tap((v) => SyncLog.log('syncSettingsForm$', redactSensitiveFields(v))),
  );

  async updateEncryptionPassword(
    pwd: string,
    syncProviderId?: SyncProviderId,
  ): Promise<void> {
    const activeProvider = syncProviderId
      ? this._providerManager.getProviderById(syncProviderId)
      : this._providerManager.getActiveProvider();
    if (!activeProvider) {
      // During initial sync setup, no provider exists yet to store the key.
      // The key will be saved when the user completes provider configuration.
      SyncLog.err(
        'No active sync provider found when trying to update encryption password',
      );
      return;
    }
    const oldConfig = await activeProvider.privateCfg.load();

    // Build new config - for SuperSync, always enable encryption when password is set
    const newConfig = {
      ...oldConfig,
      encryptKey: pwd,
    } as PrivateCfgByProviderId<SyncProviderId>;

    // For SuperSync, explicitly enable encryption
    if (activeProvider.id === SyncProviderId.SuperSync) {
      (newConfig as SuperSyncPrivateCfg).isEncryptionEnabled = true;
    }

    await this._providerManager.setProviderConfig(activeProvider.id, newConfig);

    // Ensure global config reflects encryption enabled when password is entered
    this._globalConfigService.updateSection('sync', { isEncryptionEnabled: true });

    // Clear cached encryption keys to force re-derivation with new password
    this._derivedKeyCache.clearCache();
    // Clear cached adapters to force recreation with new encryption settings
    this._wrappedProvider.clearCache();
  }

  async updateSettingsFromForm(newSettings: SyncConfig, isForce = false): Promise<void> {
    // Formly can trigger multiple updates for a single user action, causing sync conflicts
    // and unnecessary API calls. This check prevents duplicate saves.
    const isEqual = JSON.stringify(this._lastSettings) === JSON.stringify(newSettings);
    if (isEqual && !isForce) {
      return;
    }
    this._lastSettings = newSettings;

    const providerId = newSettings.syncProvider as SyncProviderId | null;

    // Split settings into public (global config) and private (credentials/secrets)
    // to maintain security boundaries - credentials never go to global config
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { encryptKey, webDav, localFileSync, superSync, ...globalConfig } = newSettings;
    // Provider-specific settings (URLs, credentials) must be stored securely
    if (providerId) {
      await this._updatePrivateConfig(providerId, newSettings);
    }

    // For SuperSync, propagate provider-specific encryption setting to global config
    // This ensures sync services see isEncryptionEnabled=true when SuperSync encryption is enabled
    // Note: We need to check the SAVED private config because Formly doesn't include hidden fields
    if (providerId === SyncProviderId.SuperSync) {
      const activeProvider = this._providerManager.getProviderById(providerId);
      const savedPrivateCfg = activeProvider
        ? await activeProvider.privateCfg.load()
        : null;
      const isEncryptionEnabled =
        superSync?.isEncryptionEnabled ??
        (savedPrivateCfg as { isEncryptionEnabled?: boolean } | null)
          ?.isEncryptionEnabled ??
        false;
      if (isEncryptionEnabled) {
        globalConfig.isEncryptionEnabled = true;
      }
    }

    this._globalConfigService.updateSection('sync', globalConfig);
  }

  private async _updatePrivateConfig(
    providerId: SyncProviderId,
    settings: SyncConfig,
  ): Promise<void> {
    const prop = PROP_MAP_TO_FORM[providerId];

    // Load existing config to preserve OAuth tokens and other settings
    const activeProvider = this._providerManager.getProviderById(providerId);
    const oldConfig = activeProvider ? await activeProvider.privateCfg.load() : {};

    // Form fields contain provider-specific settings, but Dropbox uses OAuth tokens
    // stored elsewhere, so it only needs the encryption key
    const privateConfigProviderSpecific = prop ? settings[prop] || {} : {};

    // Start with defaults to ensure API calls won't fail due to undefined values,
    // then overlay old config to preserve existing data (like OAuth tokens),
    // then overlay user settings, and always include encryption key for data security
    // NOTE: that we need the old config here in order not to overwrite other private stuff like tokens
    const providerCfgAsRecord = privateConfigProviderSpecific as Record<string, unknown>;

    // Filter out empty/undefined values from form to preserve existing credentials
    // This prevents resetOnHide and other form behaviors from clearing saved tokens
    // Empty credentials should be cleared by disabling the provider, not by form state
    const nonEmptyFormValues = Object.entries(providerCfgAsRecord).reduce(
      (acc, [key, value]) => {
        // Only include values that are truthy OR explicitly false/0
        // Skip: undefined, null, empty string
        if (value !== undefined && value !== null && value !== '') {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, unknown>,
    );

    // The provider's saved config is the source of truth after EncryptionDisableService runs
    // oldConfig is loaded from activeProvider.privateCfg.load()
    // When encryption is explicitly disabled, we must clear encryptKey regardless of form state
    const isEncryptionDisabledInSavedConfig =
      providerId === SyncProviderId.SuperSync &&
      (oldConfig as { isEncryptionEnabled?: boolean })?.isEncryptionEnabled === false;

    const savedEncryptKey = (oldConfig as { encryptKey?: string })?.encryptKey ?? '';

    // Resolve encryptKey based on provider type:
    // - SuperSync: encryptKey is managed via dedicated dialogs (EnableEncryption, ChangePassword,
    //   HandleDecryptError), NOT via the form. Always preserve savedEncryptKey unless disabled.
    // - File-based providers (WebDAV, LocalFile, Dropbox): encryptKey can be set via form,
    //   so use settings.encryptKey as fallback for new configs.
    let resolvedEncryptKey: string;
    if (isEncryptionDisabledInSavedConfig) {
      resolvedEncryptKey = '';
    } else if (providerId === SyncProviderId.SuperSync) {
      // For SuperSync, only use form if explicitly provided, otherwise preserve saved
      resolvedEncryptKey = (nonEmptyFormValues?.encryptKey as string) || savedEncryptKey;
    } else {
      // For file-based providers, use form values with settings.encryptKey as fallback
      resolvedEncryptKey =
        (nonEmptyFormValues?.encryptKey as string) || settings.encryptKey || '';
    }

    const configWithDefaults = {
      ...PROVIDER_FIELD_DEFAULTS[providerId],
      ...oldConfig,
      ...nonEmptyFormValues, // Only non-empty values overwrite saved config
      encryptKey: resolvedEncryptKey,
    };

    // Check if encryption settings changed to clear cached keys
    const oldEncryptKey = (oldConfig as { encryptKey?: string })?.encryptKey;
    const newEncryptKey = configWithDefaults.encryptKey as string;
    const isEncryptionChanged = oldEncryptKey !== newEncryptKey;

    await this._providerManager.setProviderConfig(
      providerId,
      configWithDefaults as PrivateCfgByProviderId<SyncProviderId>,
    );

    // Clear cache on ANY encryption change (not just disable)
    if (isEncryptionChanged && (oldEncryptKey || newEncryptKey)) {
      SyncLog.normal(
        'SyncConfigService: Encryption settings changed, clearing cached keys',
      );
      this._derivedKeyCache.clearCache();
      // Clear cached adapters to force recreation with new encryption settings
      this._wrappedProvider.clearCache();
    }
  }
}
