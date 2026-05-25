import { PluginManifest } from '../plugin-api.model';
import { LanguageCode } from '../../core/locale.constants';

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
  }

  if (!manifest?.name) {
    errors.push('Plugin name is required');
  }

  if (!manifest?.version) {
    errors.push('Plugin version is required');
  }

  // Validate i18n configuration if present
  if (manifest?.i18n) {
    if (!Array.isArray(manifest.i18n.languages)) {
      errors.push('i18n.languages must be an array');
    } else if (manifest.i18n.languages.length === 0) {
      warnings.push('i18n.languages is empty - plugin will have no translations');
    } else {
      // Validate language codes
      const validLanguages = Object.values(LanguageCode);
      const invalidLanguages = manifest.i18n.languages.filter(
        (lang) => !validLanguages.includes(lang as LanguageCode),
      );

      if (invalidLanguages.length > 0) {
        warnings.push(
          `Unsupported language codes: ${invalidLanguages.join(', ')} - these will be ignored`,
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
