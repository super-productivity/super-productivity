import { PluginManifest } from '../plugin-api.model';
import { SUPPORTED_LANGUAGE_CODES } from '../../core/locale.constants';
import { environment } from '../../../environments/environment';
import { compareVersions } from './community-plugin.util';
import {
  isHostname,
  isValidDestination,
  KNOWN_SHARED_DATA,
} from './plugin-data-sharing.util';

const MAX_REPORTED_INVALID_LANGUAGES = 10;
const MAX_REPORTED_LANGUAGE_LENGTH = 20;

/**
 * Simplified manifest validation following KISS principles.
 * Only validate what's absolutely necessary for the app to function.
 */
export const validatePluginManifest = (
  manifest: PluginManifest,
  appVersion = environment.version,
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

  if (
    typeof manifest?.minSupVersion === 'string' &&
    compareVersions(manifest.minSupVersion, appVersion) === 1
  ) {
    errors.push(
      `Plugin requires Super Productivity ${manifest.minSupVersion} or newer (current: ${appVersion}). Please update Super Productivity.`,
    );
  }

  // Validate allowedHosts if present (host-only exact allowlist for PluginAPI.request)
  if (manifest?.allowedHosts !== undefined) {
    if (!Array.isArray(manifest.allowedHosts)) {
      errors.push('allowedHosts must be an array of hostnames');
    } else {
      const badEntries = manifest.allowedHosts.filter((h) => !isHostname(h));
      if (badEntries.length > 0) {
        errors.push(
          'allowedHosts entries must be non-empty hostnames without scheme, port, or path (e.g. "api.example.com")',
        );
      }
    }
  }

  if (manifest?.dataSharing !== undefined) {
    validateDataSharing(manifest, errors, warnings);
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

// Keep in sync with the request-host check in plugin-bridge.service.ts (and the copy in
// electron/bundled-plugin-ids.test.cjs).
const normalizeHost = (h: string): string => h.trim().toLowerCase().replace(/\.$/, '');

/**
 * Wrong shapes are errors; unknown data values only warn, so a plugin built for a newer
 * app still installs on an older one (they render as "other data").
 */
const validateDataSharing = (
  manifest: PluginManifest,
  errors: string[],
  warnings: string[],
): void => {
  const destinations: unknown = manifest.dataSharing;
  if (!Array.isArray(destinations) || !destinations.every(isValidDestination)) {
    errors.push(
      'dataSharing must be an array of { recipient, data[], optionalData?[], hosts?[], userServer?, privacyPolicyUrl? (https) }',
    );
    return;
  }
  const declaredHosts = new Set(
    destinations.flatMap((d) => d.hosts ?? []).map(normalizeHost),
  );
  // A non-array allowedHosts is already reported above.
  const allowedHosts = Array.isArray(manifest.allowedHosts) ? manifest.allowedHosts : [];
  const undeclared = allowedHosts.filter(
    (h) => typeof h === 'string' && !declaredHosts.has(normalizeHost(h)),
  );
  if (undeclared.length > 0) {
    errors.push(
      `allowedHosts must also appear in dataSharing hosts: ${undeclared.slice(0, 10).join(', ')}`,
    );
  }
  const unknown = destinations
    .flatMap((d) => [...d.data, ...(d.optionalData ?? [])])
    .filter((v) => !KNOWN_SHARED_DATA.has(v));
  if (unknown.length > 0) {
    warnings.push(
      `Unknown dataSharing values: ${unknown
        .slice(0, MAX_REPORTED_INVALID_LANGUAGES)
        .map((v) => v.slice(0, MAX_REPORTED_LANGUAGE_LENGTH))
        .join(', ')} - shown as "other data"`,
    );
  }
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
