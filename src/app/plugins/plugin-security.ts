import { Injectable } from '@angular/core';
import { PluginManifest } from './plugin-api.model';

/**
 * Simplified plugin security service following KISS principles.
 * Focuses on user awareness rather than restrictive validation.
 */
@Injectable({
  providedIn: 'root',
})
export class PluginSecurityService {
  private readonly MAX_PLUGIN_SIZE = 1024 * 1024; // 1MB - be generous

  /**
   * Analyze plugin code and return warnings for user awareness.
   * Does NOT block execution - trusts users to make informed decisions.
   */
  analyzePluginCode(
    code: string,
    manifest?: PluginManifest,
  ): { warnings: string[]; info: string[] } {
    const warnings: string[] = [];
    const info: string[] = [];

    // Size check (informational)
    if (code.length > this.MAX_PLUGIN_SIZE) {
      warnings.push(
        `Plugin is large (${Math.round(code.length / 1024)}KB). This may impact performance.`,
      );
    }

    // Look for common patterns and inform user
    if (/eval\s*\(/.test(code)) {
      info.push('Uses eval() - plugin can execute dynamic code');
    }

    if (/require\s*\(\s*['"`](fs|child_process)/.test(code)) {
      if (manifest?.permissions?.includes('nodeExecution')) {
        info.push('Uses file system or process APIs (has permission)');
      } else {
        warnings.push('Attempts to use Node.js APIs without permission - will fail');
      }
    }

    if (/fetch|XMLHttpRequest/.test(code)) {
      info.push('Makes network requests');
    }

    if (/localStorage|sessionStorage/.test(code)) {
      info.push('Uses browser storage');
    }

    return { warnings, info };
  }

  /**
   * Check if plugin requires elevated permissions.
   * Simplified to focus only on truly dangerous permissions.
   */
  hasElevatedPermissions(manifest: PluginManifest): boolean {
    return manifest.permissions?.includes('nodeExecution') || false;
  }

  /**
   * Get human-readable permission descriptions
   */
  getPermissionDescriptions(manifest: PluginManifest): string[] {
    const descriptions: string[] = [];

    if (manifest.permissions?.includes('nodeExecution')) {
      descriptions.push('🔴 Can execute system commands and access files');
    }

    if (manifest.permissions?.includes('http')) {
      const hosts = manifest.allowedHosts?.length
        ? manifest.allowedHosts.join(', ')
        : '(none declared — network disabled)';
      descriptions.push('🟡 Can make network requests to: ' + hosts);
    }

    if (manifest.iFrame) {
      descriptions.push('🟡 Displays custom user interface');
    }

    if (manifest.hooks && manifest.hooks.length > 0) {
      descriptions.push('🟢 Responds to app events: ' + manifest.hooks.join(', '));
    }

    return descriptions;
  }

  /**
   * Minimal HTML sanitization - just prevent the worst attacks.
   * Trust the browser's built-in protections for most things.
   */
  sanitizeHtml(html: string): string {
    // Only remove truly dangerous elements
    return html
      .replace(/<script[^>]*>.*?<\/script>/gis, '') // No inline scripts
      .replace(/<iframe[^>]*>.*?<\/iframe>/gis, '') // No nested iframes
      .replace(/javascript:/gi, '#'); // No javascript: URLs
  }
}
