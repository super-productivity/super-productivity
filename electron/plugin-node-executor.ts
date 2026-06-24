import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join, resolve as resolvePath } from 'path';
import * as vm from 'vm';
import { IPC } from './shared-with-frontend/ipc-events.const';
import {
  PluginNodeScriptRequest,
  PluginNodeScriptResult,
  PluginManifest,
} from '../packages/plugin-api/src/types';

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_TIMEOUT = 300000; // 5 minutes
const BUILT_IN_PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

// Uploaded (community) plugin ids are NOT held to the strict built-in kebab rule —
// they may legitimately use dots/uppercase — but an uploaded id is attacker-controlled
// and used both as a grant Map key and as consent-dialog text, so it must reject
// anything unsafe for those uses (control/zero-width/bidi chars that could spoof the
// dialog, whitespace that could inject extra dialog lines, the ':' persistence
// delimiter) and stay within a sane length.
const MAX_UPLOADED_PLUGIN_ID_LENGTH = 100;
const UNSAFE_ID_CHARS_RE =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069:\s]/;
// Self-declared name/version are display-only; strip control/bidi chars and collapse
// whitespace (global flag is for replace, not test, so no lastIndex statefulness).
const UNSAFE_DISPLAY_CHARS_RE =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

const assertSafePluginId = (pluginId: unknown): string => {
  if (typeof pluginId !== 'string' || pluginId.length === 0) {
    throw new Error('Invalid pluginId');
  }
  if (pluginId.length > MAX_UPLOADED_PLUGIN_ID_LENGTH) {
    throw new Error('Invalid pluginId');
  }
  if (UNSAFE_ID_CHARS_RE.test(pluginId)) {
    throw new Error('Invalid pluginId');
  }
  // The id is used as a path segment in getBuiltInManifestPath() (existsSync probe),
  // so reject path separators and dot-segments — otherwise an id like '..' could probe
  // outside the bundled-plugins dir and render misleadingly in the dialog.
  if (
    pluginId.includes('/') ||
    pluginId.includes('\\') ||
    pluginId === '.' ||
    pluginId === '..'
  ) {
    throw new Error('Invalid pluginId');
  }
  return pluginId;
};

const sanitizeDialogString = (value: unknown, maxLength: number): string => {
  if (typeof value !== 'string') {
    return '';
  }
  const cleaned = value.replace(UNSAFE_DISPLAY_CHARS_RE, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
};

// Shared shell for both nodeExecution consent dialogs: a warning with Allow/Deny where
// Deny is the default + cancel action, so a reflexive Enter/Escape denies.
const NODE_CONSENT_DIALOG_BASE: Pick<
  Electron.MessageBoxOptions,
  'type' | 'buttons' | 'defaultId' | 'cancelId'
> = {
  type: 'warning',
  buttons: ['Allow', 'Deny'],
  defaultId: 1,
  cancelId: 1,
};

interface NodeExecutionGrant {
  token: string;
  webContentsId: number;
}

/** Self-declared, unverified display metadata supplied by the renderer for uploaded plugins. */
interface NodeExecutionGrantDisplayInfo {
  name?: string;
  version?: string;
}

interface WebContentsGrantCleanup {
  webContents: WebContents;
  cleanup: () => void;
  didStartNavigation: (
    event: Electron.Event,
    url: string,
    isInPlace: boolean,
    isMainFrame: boolean,
  ) => void;
}

class PluginNodeExecutor {
  /**
   * Main-owned per-session execution grants. Renderer code may request a grant,
   * but it cannot set one silently; the main process issues the token only after
   * a native consent dialog. Execution never trusts renderer-provided manifests.
   */
  private readonly grants = new Map<string, NodeExecutionGrant>();
  private readonly grantCleanupByWebContents = new Map<number, WebContentsGrantCleanup>();

  constructor() {
    this.setupIpcHandler();
  }

  private setupIpcHandler(): void {
    ipcMain.handle(
      IPC.PLUGIN_REQUEST_NODE_EXECUTION_GRANT,
      async (event, pluginId: string, displayInfo?: NodeExecutionGrantDisplayInfo) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
          throw new Error('No window found for event sender');
        }

        // Sanitize first: the id is used as a grant Map key AND shown in the consent
        // dialog, and for uploaded plugins it is attacker-controlled.
        const safeId = assertSafePluginId(pluginId);

        const webContentsId = event.sender.id;
        const existingGrant = this.grants.get(safeId);
        if (existingGrant) {
          if (existingGrant.webContentsId === webContentsId) {
            return { token: existingGrant.token };
          }
          this.grants.delete(safeId);
          this.releaseGrantCleanupIfUnused(existingGrant.webContentsId);
        }

        // Bundled vs uploaded is decided by the main-owned filesystem, never by a
        // renderer-supplied flag: a bundled id always uses its verified on-disk
        // manifest, so uploaded code can't borrow a built-in plugin's trusted name.
        const dialogOptions = this.getBuiltInManifestPath(safeId)
          ? this.describeVerifiedBuiltInDialog(safeId)
          : this.describeUnverifiedUploadedDialog(safeId, displayInfo);

        const requestUrl = event.sender.getURL();
        this.registerGrantCleanup(event.sender);

        let result: Electron.MessageBoxReturnValue;
        try {
          result = await dialog.showMessageBox(window, dialogOptions);
        } catch (error) {
          this.releaseGrantCleanupIfUnused(webContentsId);
          throw error;
        }

        if (
          event.sender.isDestroyed() ||
          !this.grantCleanupByWebContents.has(webContentsId) ||
          event.sender.getURL() !== requestUrl
        ) {
          this.grants.delete(safeId);
          this.releaseGrantCleanupIfUnused(webContentsId);
          return null;
        }

        if (result.response !== 0) {
          this.grants.delete(safeId);
          this.releaseGrantCleanupIfUnused(webContentsId);
          return null;
        }

        const token = randomBytes(32).toString('base64url');
        this.grants.set(safeId, {
          token,
          webContentsId,
        });
        return { token };
      },
    );

    ipcMain.handle(
      IPC.PLUGIN_REVOKE_NODE_EXECUTION_GRANT,
      // grantToken is accepted for signature compatibility but intentionally not
      // required: revoking only removes a capability, and the issuing window must be
      // able to drop its own grant during teardown even if it no longer holds the
      // token (e.g. on re-upload) — otherwise a re-uploaded plugin reusing the id
      // could inherit a live session grant. The webContents binding still prevents
      // another window from revoking this one's grant.
      (event, pluginId: string, _grantToken?: string) => {
        const grant = this.grants.get(pluginId);
        if (grant && grant.webContentsId === event.sender.id) {
          this.grants.delete(pluginId);
        }
      },
    );

    ipcMain.handle(
      IPC.PLUGIN_EXEC_NODE_SCRIPT,
      async (
        event,
        pluginId: string,
        grantToken: string,
        request: PluginNodeScriptRequest,
      ) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
          throw new Error('No window found for event sender');
        }

        const grant = this.grants.get(pluginId);
        if (
          !grant ||
          grant.token !== grantToken ||
          grant.webContentsId !== event.sender.id
        ) {
          throw new Error('Plugin is not authorized for nodeExecution');
        }

        return await this.executeScript(pluginId, request);
      },
    );
  }

  private registerGrantCleanup(webContents: WebContents): void {
    const webContentsId = webContents.id;
    if (this.grantCleanupByWebContents.has(webContentsId)) {
      return;
    }

    const cleanup = (): void => {
      for (const [pluginId, grant] of this.grants.entries()) {
        if (grant.webContentsId === webContentsId) {
          this.grants.delete(pluginId);
        }
      }
      const registration = this.grantCleanupByWebContents.get(webContentsId);
      if (registration) {
        this.unregisterGrantCleanup(webContentsId);
      }
    };
    const didStartNavigation = (
      _event: Electron.Event,
      _url: string,
      isInPlace: boolean,
      isMainFrame: boolean,
    ): void => {
      if (isMainFrame && !isInPlace) {
        cleanup();
      }
    };

    this.grantCleanupByWebContents.set(webContentsId, {
      webContents,
      cleanup,
      didStartNavigation,
    });
    webContents.once('destroyed', cleanup);
    webContents.on('will-navigate', cleanup);
    webContents.on('did-navigate', cleanup);
    webContents.on('did-start-navigation', didStartNavigation);
  }

  private unregisterGrantCleanup(webContentsId: number): void {
    const registration = this.grantCleanupByWebContents.get(webContentsId);
    if (!registration) {
      return;
    }

    const { webContents } = registration;
    webContents.removeListener('destroyed', registration.cleanup);
    webContents.removeListener('will-navigate', registration.cleanup);
    webContents.removeListener('did-navigate', registration.cleanup);
    webContents.removeListener('did-start-navigation', registration.didStartNavigation);
    this.grantCleanupByWebContents.delete(webContentsId);
  }

  private releaseGrantCleanupIfUnused(webContentsId: number): void {
    for (const grant of this.grants.values()) {
      if (grant.webContentsId === webContentsId) {
        return;
      }
    }
    this.unregisterGrantCleanup(webContentsId);
  }

  /** Consent dialog for a verified built-in plugin (name/version read from disk). */
  private describeVerifiedBuiltInDialog(pluginId: string): Electron.MessageBoxOptions {
    const manifest = this.getVerifiedBuiltInNodeExecutionManifest(pluginId);
    return {
      ...NODE_CONSENT_DIALOG_BASE,
      title: 'Allow plugin Node.js execution?',
      message: `Allow "${manifest.name}" to run Node.js scripts?`,
      detail: [
        `Plugin ID: ${pluginId}`,
        `Version: ${manifest.version}`,
        '',
        'This permission is valid for the current app session. Node.js execution can access local files and desktop APIs. Only allow plugins you trust.',
      ].join('\n'),
    };
  }

  /**
   * Consent dialog for an uploaded (community) plugin. The app cannot verify an
   * uploaded plugin's identity, so the dialog anchors on the validated id and marks
   * the renderer-supplied name/version as self-declared/unverified. Default = Deny.
   */
  private describeUnverifiedUploadedDialog(
    pluginId: string,
    displayInfo?: NodeExecutionGrantDisplayInfo,
  ): Electron.MessageBoxOptions {
    const name = sanitizeDialogString(displayInfo?.name, 80) || '(unnamed)';
    const version = sanitizeDialogString(displayInfo?.version, 32) || '(unknown)';
    return {
      ...NODE_CONSENT_DIALOG_BASE,
      title: 'Allow this plugin to run code on your machine?',
      message: `Plugin "${pluginId}" wants to run Node.js code`,
      detail: [
        `Plugin ID: ${pluginId}`,
        `Name (self-declared, unverified): ${name}`,
        `Version (self-declared): ${version}`,
        '',
        'This is a third-party plugin. Super Productivity cannot verify its identity and cannot sandbox it.',
        'If you allow it, the plugin can run any program with full access to your files and system for this app session.',
        '',
        'Only allow this if you trust the source of this plugin.',
      ].join('\n'),
    };
  }

  private getVerifiedBuiltInNodeExecutionManifest(pluginId: string): PluginManifest {
    if (typeof pluginId !== 'string' || !pluginId) {
      throw new Error('Invalid pluginId');
    }
    if (!BUILT_IN_PLUGIN_ID_RE.test(pluginId)) {
      throw new Error('Invalid pluginId');
    }

    const manifestPath = this.getBuiltInManifestPath(pluginId);
    if (!manifestPath) {
      throw new Error('Plugin is not a verified built-in plugin');
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PluginManifest;
    if (!manifest || manifest.id !== pluginId) {
      throw new Error('Verified plugin manifest does not match requested plugin');
    }
    if (typeof manifest.name !== 'string' || !manifest.name) {
      throw new Error('Invalid plugin manifest name');
    }
    if (typeof manifest.version !== 'string' || !manifest.version) {
      throw new Error('Invalid plugin manifest version');
    }
    if (!manifest.permissions?.includes('nodeExecution')) {
      throw new Error('Plugin does not have nodeExecution permission');
    }
    return manifest;
  }

  private getBuiltInManifestPath(pluginId: string): string | null {
    for (const baseDir of this.getBuiltInPluginBaseDirs()) {
      const manifestPath = join(baseDir, pluginId, 'manifest.json');
      if (existsSync(manifestPath)) {
        return manifestPath;
      }
    }
    return null;
  }

  private getBuiltInPluginBaseDirs(): string[] {
    return Array.from(
      new Set(
        [
          join(__dirname, '../.tmp/angular-dist/browser/assets/bundled-plugins'),
          join(__dirname, '../src/assets/bundled-plugins'),
          ...(app.isPackaged
            ? []
            : [
                join(process.cwd(), '.tmp/angular-dist/browser/assets/bundled-plugins'),
                join(process.cwd(), 'src/assets/bundled-plugins'),
              ]),
        ].map((p) => resolvePath(p)),
      ),
    );
  }

  private async executeScript(
    pluginId: string,
    request: PluginNodeScriptRequest,
  ): Promise<PluginNodeScriptResult> {
    const startTime = Date.now();

    try {
      // Validate request
      this.validateScriptRequest(request);

      // Try direct execution first (faster, safer)
      if (this.canExecuteDirectly(request.script)) {
        const result = await this.executeDirectly(request.script, request.args);
        return {
          success: true,
          result,
          executionTime: Date.now() - startTime,
        };
      }

      // For complex scripts, use spawned process
      const result = await this.executeViaSpawn(
        request.script,
        request.args,
        request.timeout,
      );
      return {
        success: true,
        result,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
      };
    }
  }

  private validateScriptRequest(request: PluginNodeScriptRequest): void {
    if (!request.script || typeof request.script !== 'string') {
      throw new Error('Script must be a non-empty string');
    }

    if (request.script.length > 100000) {
      throw new Error('Script too large (max 100KB)');
    }

    if (request.timeout !== undefined) {
      if (typeof request.timeout !== 'number' || request.timeout < 0) {
        throw new Error('Timeout must be a positive number');
      }
      if (request.timeout > MAX_TIMEOUT) {
        throw new Error(`Timeout exceeds maximum allowed (${MAX_TIMEOUT}ms)`);
      }
    }
  }

  private canExecuteDirectly(script: string): boolean {
    // Check if script only uses safe operations
    const dangerousPatterns =
      /require\s*\(\s*['"`](?!fs|path|os)[^'"]+['"`]\s*\)|child_process|exec|spawn|eval|Function|process\.exit/;
    return !dangerousPatterns.test(script);
  }

  private async executeDirectly(script: string, args?: unknown[]): Promise<unknown> {
    // Safe modules
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    // Create sandboxed context
    const sandbox = {
      require: (module: string) => {
        if (module === 'fs') return fs;
        if (module === 'path') return path;
        if (module === 'os') return os;
        throw new Error(`Module '${module}' is not allowed`);
      },
      console: {
        log: (...logArgs: unknown[]) => console.log('[Plugin]:', ...logArgs),
        error: (...errorArgs: unknown[]) => console.error('[Plugin]:', ...errorArgs),
      },
      JSON,
      args: args || [],
      __result: undefined,
    };

    // Execute in VM with timeout
    const context = vm.createContext(sandbox);
    const script_wrapped = `
      (async function() {
        const result = await (async function() {
          ${script}
        })();
        __result = result;
      })().catch(err => { throw err; });
    `;

    await vm.runInContext(script_wrapped, context, {
      timeout: 5000, // 5 second timeout for direct execution
    });

    return sandbox.__result;
  }

  private async executeViaSpawn(
    script: string,
    args?: unknown[],
    timeout?: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeoutMs = Math.min(timeout || DEFAULT_TIMEOUT, MAX_TIMEOUT);

      // Wrap script for security
      const wrappedScript = `
        'use strict';
        (async function() {
          const args = ${JSON.stringify(args || [])};
          try {
            const result = await (async function() {
              ${script}
            })();
            console.log(JSON.stringify({ __result: result }));
          } catch (error) {
            console.error(JSON.stringify({
              __error: error.message || String(error)
            }));
            process.exit(1);
          }
        })();
      `;

      // Use electron's node or system node
      const nodePath = process.execPath.includes('electron') ? process.execPath : 'node';

      // Spawn process with script via -e flag (no temp files!)
      const child = spawn(nodePath, ['--no-warnings', '-e', wrappedScript], {
        env: {
          NODE_ENV: 'production',
          ELECTRON_RUN_AS_NODE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      // Timeout
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        // Force kill after a short delay if process doesn't terminate
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 1000);
        reject(new Error(`Script execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error('Failed to execute script: ' + err.message));
      });

      child.on('close', (code) => {
        clearTimeout(timer);

        if (killed) return;

        try {
          if (stdout) {
            const parsed = JSON.parse(stdout.trim());
            if (parsed.__error) {
              reject(new Error(parsed.__error));
            } else {
              resolve(parsed.__result);
            }
          } else if (code !== 0) {
            reject(new Error(stderr || `Process exited with code ${code}`));
          } else {
            resolve(undefined);
          }
        } catch (e) {
          reject(new Error(`Failed to parse output: ${e}`));
        }
      });
    });
  }
}

export const pluginNodeExecutor = new PluginNodeExecutor();
