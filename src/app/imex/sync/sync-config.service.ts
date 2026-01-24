import { inject, Injectable } from '@angular/core';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { combineLatest, from, Observable, of } from 'rxjs';
import { SyncConfig } from '../../features/config/global-config.model';
import { switchMap, tap } from 'rxjs/operators';
import { PrivateCfgByProviderId, SyncProviderId } from '../../op-log/sync-exports';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { SyncLog } from '../../core/log';
import { DerivedKeyCacheService } from '../../op-log/encryption/derived-key-cache.service';

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

  private _lastSettings: SyncConfig | null = null;

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
            .catch(() => {
              return {
                ...baseConfig,
                encryptKey: '',
              };
            }),
        );
      }

      const prop = PROP_MAP_TO_FORM[currentProviderCfg.providerId];

      // Create config with provider-specific settings
      const result: SyncConfig = {
        ...baseConfig,
        encryptKey: currentProviderCfg?.privateCfg?.encryptKey || '',
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

    await this._providerManager.setProviderConfig(activeProvider.id, {
      ...oldConfig,
      encryptKey: pwd,
    } as PrivateCfgByProviderId<SyncProviderId>);

    // Clear cached encryption keys to force re-derivation with new password
    this._derivedKeyCache.clearCache();
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

    const configWithDefaults = {
      ...PROVIDER_FIELD_DEFAULTS[providerId],
      ...oldConfig,
      ...nonEmptyFormValues, // Only non-empty values overwrite saved config
      // Use provider specific key if available, otherwise fallback to root key
      encryptKey: (nonEmptyFormValues?.encryptKey as string) || settings.encryptKey || '',
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
    }
  }
}
