import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { PluginLog } from '../core/log';
import { GlobalConfigService } from '../features/config/global-config.service';
import { DEFAULT_LANGUAGE } from '../core/locale.constants';

interface PluginTranslations {
  [language: string]: Record<string, unknown>;
}

/**
 * Simplified plugin i18n service following KISS principles.
 * Handles translation loading, fallback, and parameter interpolation for plugins.
 */
@Injectable({
  providedIn: 'root',
})
export class PluginI18nService {
  private readonly _http = inject(HttpClient);
  private readonly _globalConfigService = inject(GlobalConfigService);

  // Map of pluginId -> translations by language
  private readonly _translations = new Map<string, PluginTranslations>();

  // Current language as a signal
  private readonly _currentLanguage = signal<string>(DEFAULT_LANGUAGE);
  readonly currentLanguage = this._currentLanguage.asReadonly();

  constructor() {
    // Initialize current language from global config
    // Note: Language changes are handled via setCurrentLanguage() which should
    // be called when the LANGUAGE_CHANGE hook fires or when global config updates
    const lng = this._globalConfigService.localization()?.lng;
    if (lng) {
      this._currentLanguage.set(lng);
    }
  }

  /**
   * Load translation files for a plugin from a file path
   */
  async loadPluginTranslationsFromPath(
    pluginId: string,
    pluginPath: string,
    languages: string[],
  ): Promise<void> {
    const translations: PluginTranslations = {};

    for (const lang of languages) {
      const translationPath = `${pluginPath}/i18n/${lang}.json`;

      try {
        const content = await firstValueFrom(
          this._http.get<Record<string, unknown>>(translationPath),
        );
        translations[lang] = content;
        PluginLog.log(`[PluginI18n] Loaded ${lang} translations for ${pluginId}`);
      } catch (error) {
        PluginLog.err(
          `[PluginI18n] Failed to load ${lang} translations for ${pluginId}:`,
          error,
        );
      }
    }

    // Warn if English translations missing
    if (!translations['en'] && languages.includes('en')) {
      PluginLog.err(
        `[PluginI18n] Missing English (en) translations for ${pluginId} - translations will fall back to keys`,
      );
    }

    this._translations.set(pluginId, translations);
  }

  /**
   * Load translations from pre-loaded content (for cached plugins)
   */
  loadPluginTranslationsFromContent(
    pluginId: string,
    translationsContent: Record<string, string>,
  ): void {
    const translations: PluginTranslations = {};

    for (const [lang, content] of Object.entries(translationsContent)) {
      try {
        // Validate content is a string before parsing
        if (typeof content !== 'string') {
          PluginLog.err(
            `[PluginI18n] Invalid content type for ${lang} in ${pluginId}: expected string, got ${typeof content}`,
          );
          continue;
        }

        translations[lang] = JSON.parse(content);
        PluginLog.log(
          `[PluginI18n] Loaded ${lang} translations for ${pluginId} from cache`,
        );
      } catch (error) {
        PluginLog.err(
          `[PluginI18n] Failed to parse ${lang} translations for ${pluginId}:`,
          error,
        );
      }
    }

    this._translations.set(pluginId, translations);
  }

  /**
   * Translate a key for a plugin with fallback logic
   */
  translate(
    pluginId: string,
    key: string,
    params?: Record<string, string | number>,
  ): string {
    const pluginTranslations = this._translations.get(pluginId);
    if (!pluginTranslations) {
      return key;
    }

    const currentLang = this._currentLanguage();

    // Try current language first
    let translation = this._getTranslation(pluginTranslations[currentLang], key);

    // Fall back to English if not found
    if (translation === key && currentLang !== 'en') {
      translation = this._getTranslation(pluginTranslations['en'], key);
    }

    // Interpolate parameters if provided
    if (params && translation !== key) {
      return this._interpolate(translation, params);
    }

    return translation;
  }

  /**
   * Get a translation from a translation object by nested key
   */
  private _getTranslation(
    translationObj: Record<string, unknown> | undefined,
    key: string,
  ): string {
    if (!translationObj) {
      return key;
    }

    const keys = key.split('.');
    let current: unknown = translationObj;

    for (const k of keys) {
      if (current && typeof current === 'object' && k in current) {
        current = (current as Record<string, unknown>)[k];
      } else {
        return key;
      }
    }

    return typeof current === 'string' ? current : key;
  }

  /**
   * Interpolate parameters into a translation string
   */
  private _interpolate(
    translation: string,
    params: Record<string, string | number>,
  ): string {
    let result = translation;

    // Replace all parameter placeholders
    for (const [param, value] of Object.entries(params)) {
      const placeholder = `{{${param}}}`;
      const replacement = String(value);

      // Simple string replacement - safe from circular references
      result = result.split(placeholder).join(replacement);
    }

    return result;
  }

  /**
   * Set the current language (called when app language changes)
   */
  setCurrentLanguage(language: string): void {
    this._currentLanguage.set(language);
    PluginLog.log(`[PluginI18n] Language changed to: ${language}`);
  }

  /**
   * Get the current language code
   */
  getCurrentLanguage(): string {
    return this._currentLanguage();
  }

  /**
   * Unload translations for a plugin (cleanup)
   */
  unloadPluginTranslations(pluginId: string): void {
    this._translations.delete(pluginId);
    PluginLog.log(`[PluginI18n] Unloaded translations for ${pluginId}`);
  }
}
