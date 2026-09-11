import { PluginManifest } from '../plugin-api.model';
import { SUPPORTED_LANGUAGE_CODES } from '../../core/locale.constants';

const MAX_REPORTED_INVALID_LANGUAGES = 10;
const MAX_REPORTED_LANGUAGE_LENGTH = 20;

/**
 * Simplified manifest validation following KISS principles.
 * Only validate what's absolutely necessary for the app to function.
 */
export const validatePluginManifest = (
  manifest: PluginManifest,
): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} => {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Only validate critical fields
  if (!manifest?.id) {
    errors.push('Plugin ID is required');
  } else if (manifest.id.includes(':')) {
    // ':' is reserved as the persistence key delimiter (composeId). An id
    // containing it would collide with another plugin's keyed namespace —
    // and removePluginUserData's prefix sweep would over-match. The bridge
    // also throws at the persist/load boundary, but rejecting at install
    // fails fast with a clear message instead of a runtime surprise.
    errors.push(
      "Plugin ID must not contain ':' (reserved as the persistence key delimiter)",
    );
  }

  if (!manifest?.name) {
    errors.push('Plugin name is required');
  }

  if (!manifest?.version) {
    errors.push('Plugin version is required');
  }

  // Validate allowedHosts if present (host-only exact allowlist for PluginAPI.request)
  if (manifest?.allowedHosts !== undefined) {
    if (!Array.isArray(manifest.allowedHosts)) {
      errors.push('allowedHosts must be an array of hostnames');
    } else {
      const badEntries = manifest.allowedHosts.filter(
        (h) => typeof h !== 'string' || h.trim().length === 0 || /[/:]/.test(h),
      );
      if (badEntries.length > 0) {
        errors.push(
          'allowedHosts entries must be non-empty hostnames without scheme, port, or path (e.g. "api.example.com")',
        );
      }
    }
  }

  // Validate i18n configuration if present
  if (manifest?.i18n) {
    if (!Array.isArray(manifest.i18n.languages)) {
      errors.push('i18n.languages must be an array');
    } else if (manifest.i18n.languages.length === 0) {
      warnings.push('i18n.languages is empty - plugin will have no translations');
    } else {
      // Validate language codes
      const invalidLanguages = manifest.i18n.languages.filter(
        (lang) => !SUPPORTED_LANGUAGE_CODES.has(lang),
      );

      if (invalidLanguages.length > 0) {
        // `languages` is third-party and bounded only by the 100KB manifest cap, and
        // this warning is logged verbatim into the exportable log history. Bound BOTH
        // the number of codes and the length of each: capping only the count still
        // allows a handful of 8000-character codes to produce an ~80KB log entry.
        const shown = invalidLanguages
          .slice(0, MAX_REPORTED_INVALID_LANGUAGES)
          .map((lang) => String(lang).slice(0, MAX_REPORTED_LANGUAGE_LENGTH));
        const rest = invalidLanguages.length - shown.length;
        warnings.push(
          `Unsupported language codes: ${shown.join(', ')}` +
            `${rest > 0 ? ` (+${rest} more)` : ''} - these will be ignored`,
        );
      }

      // Warn if English not included
      if (!manifest.i18n.languages.includes('en')) {
        warnings.push(
          'English (en) not in i18n.languages - translations will fall back to keys',
        );
      }
    }
  }

  // That's it! Let plugins define whatever else they want.
  // Trust developers to know what they're doing.

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
};

/**
 * Check if plugin has elevated permissions (simplified)
 */
export const hasNodeExecutionPermission = (manifest: PluginManifest): boolean => {
  return manifest.permissions?.includes('nodeExecution') || false;
};

/**
 * Alias for hasNodeExecutionPermission for compatibility
 */
export const requiresDangerousPermissions = hasNodeExecutionPermission;
