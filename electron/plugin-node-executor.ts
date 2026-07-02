import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { error as logError } from 'electron-log/main';
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
import {
  clearNodeExecutionConsent,
  getNodeExecutionConsent,
  setNodeExecutionConsent,
} from './plugin-node-consent-store';

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_TIMEOUT = 300000; // 5 minutes
const BUILT_IN_PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

// An uploaded (community) plugin id is attacker-controlled and used both as a grant Map
// key and as the consent dialog's trust anchor ("Plugin ID: ..."), and as a path segment
// in getBuiltInManifestPath(). It is NOT held to the strict built-in kebab rule —
// community ids may use dots/uppercase, e.g. `super-productivity-mcp` — but it must be a
// single safe ASCII token. We use an allowlist rather than a denylist on purpose: the
// allowlist rejects control/zero-width/bidi/homoglyph characters that could spoof the
// dialog, whitespace that could inject extra dialog lines, the ':' persistence delimiter,
// and path separators / leading-dot segments ('.', '..', '/', '\\') — all by construction,
// with no Unicode range to keep updated as new code points are assigned.
const MAX_UPLOADED_PLUGIN_ID_LENGTH = 100;
const SAFE_UPLOADED_PLUGIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// The id is used as a key into the persisted-consent store, which keys consent in a `Map`
// (returns `undefined` for any unstored key) so an `Object.prototype` member name can't
// masquerade as a stored grant. Reject the classic pollution keys at this boundary too as
// defense in depth (`__proto__` is already excluded by the leading-char allowlist; the
// others pass it).
const FORBIDDEN_PLUGIN_IDS = new Set(['__proto__', 'prototype', 'constructor']);
// Self-declared name/version are display-only. Strip every Unicode control (Cc) and
// format (Cf) character — this covers C0/C1 controls, all zero-width characters, the BOM,
// and every bidi control (incl. U+061C ALM, the word-joiner range, and the isolate marks)
// without enumerating ranges — then collapse whitespace so a crafted value cannot inject
// extra dialog lines. (Global flag is for replace, not test, so no lastIndex statefulness.)
const UNSAFE_DISPLAY_CHARS_RE = /[\p{Cc}\p{Cf}]/gu;

const assertSafePluginId = (pluginId: unknown): string => {
  if (typeof pluginId !== 'string' || pluginId.length === 0) {
    throw new Error('Invalid pluginId');
  }
  if (pluginId.length > MAX_UPLOADED_PLUGIN_ID_LENGTH) {
    throw new Error('Invalid pluginId');
  }
  // Allowlist match also rejects path separators ('/'/'\\'), leading-dot segments
  // ('.', '..'), ':', whitespace and all non-ASCII (bidi/zero-width/homoglyph), so the id
  // can neither escape the bundled-plugins dir in getBuiltInManifestPath() nor spoof the
  // consent dialog's trust anchor.
  if (!SAFE_UPLOADED_PLUGIN_ID_RE.test(pluginId)) {
    throw new Error('Invalid pluginId');
  }
  if (FORBIDDEN_PLUGIN_IDS.has(pluginId)) {
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
        // Captured before any await so both the ask-once and dialog paths can detect a
        // navigation that happened while we were resolving consent.
        const requestUrl = event.sender.getURL();
        const existingGrant = this.grants.get(safeId);
        if (existingGrant) {
          if (existingGrant.webContentsId === webContentsId) {
            return { token: existingGrant.token };
          }
          this.grants.delete(safeId);
          this.releaseGrantCleanupIfUnused(existingGrant.webContentsId);
        }

        // Bundled vs uploaded is decided by the main-owned filesystem, never by a
        // renderer-supplied flag, and only an id that resolves to a cleanly-verified
        // on-disk manifest gets the trusted built-in dialog. A partial or colliding match
        // (id mismatch, missing nodeExecution permission, unreadable manifest) returns
        // null and falls back to the unverified dialog, so uploaded code can never borrow
        // a built-in plugin's trusted name even if its id collides with a bundled dir.
        const builtInManifest = this.tryGetVerifiedBuiltInManifest(safeId);

        // Phase 2 (issue #8512): persisted, ask-once consent is scoped to UPLOADED
        // (community) plugins only. Built-in plugins keep the per-session verified prompt
        // — no behaviour change, so `sync-md` etc. are regression-safe. Only a prior
        // native Allow can have written this entry (no renderer write path), and the
        // renderer clears it on disable/uninstall/re-upload, so a re-uploaded (changed)
        // plugin reusing the id never silently inherits it.
        if (!builtInManifest) {
          const persistedConsent = await getNodeExecutionConsent(safeId);
          if (persistedConsent) {
            // Don't mint for a sender that was destroyed or navigated away while the
            // consent was being read (parity with the post-dialog checks below).
            if (event.sender.isDestroyed() || event.sender.getURL() !== requestUrl) {
              return null;
            }
            this.registerGrantCleanup(event.sender);
            return this.mintGrant(safeId, webContentsId);
          }
        }

        const dialogOptions = builtInManifest
          ? this.buildVerifiedBuiltInDialog(safeId, builtInManifest)
          : this.describeUnverifiedUploadedDialog(safeId, displayInfo);

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

        // Allow → mint the grant FIRST, synchronously, right after the sender-validity
        // check above. The persist below is a new `await`; minting before it keeps the
        // "never mint for a navigated/destroyed sender" invariant tight — if the sender
        // navigates or is destroyed during the write, the cleanup listener registered
        // before the dialog drops this just-minted grant, so no untracked grant survives
        // for a stale webContents.
        const grant = this.mintGrant(safeId, webContentsId);

        // For uploaded plugins, remember the decision so later sessions don't re-prompt
        // (ask-once). Persisting is best-effort: a write failure only costs a re-prompt
        // next session, never a grant the user just approved.
        if (!builtInManifest) {
          try {
            // Persist exactly the name/version the user saw in the dialog.
            await setNodeExecutionConsent(safeId, {
              ...this.sanitizedUploadedDisplay(displayInfo),
              grantedAt: Date.now(),
            });
          } catch (error) {
            // Host diagnostic → exportable log (electron-log), distinct from the sandboxed
            // plugin's own console output. Log only the validated id and the error code —
            // never the raw error, whose message can embed the userData absolute path (and
            // thus the OS username) for an fs failure.
            const code = (error as NodeJS.ErrnoException)?.code ?? 'unknown';
            logError(`Failed to persist nodeExecution consent for ${safeId} (${code})`);
          }
        }
        return grant;
      },
    );

    ipcMain.handle(
      IPC.PLUGIN_CLEAR_NODE_EXECUTION_CONSENT,
      // Explicit revoke from the trusted renderer that owns the plugin lifecycle
      // (disable / uninstall / re-upload). Drops the live session grant for this id AND
      // the persisted consent, so the next node call re-prompts. A delete is fail-safe:
      // the worst a hostile renderer can do by calling this is force a prompt, never a
      // silent grant.
      async (_event, pluginId: string) => {
        let safeId: string;
        try {
          safeId = assertSafePluginId(pluginId);
        } catch {
          return;
        }
        const grant = this.grants.get(safeId);
        if (grant) {
          this.grants.delete(safeId);
          this.releaseGrantCleanupIfUnused(grant.webContentsId);
        }
        await clearNodeExecutionConsent(safeId);
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
        // Key the lookup through the same validator the request handler uses, so the
        // "always revoke by id on teardown/re-upload" guarantee holds even if the id
        // canonicalisation ever changes (an unsafe id can never hold a grant anyway).
        let safeId: string;
        try {
          safeId = assertSafePluginId(pluginId);
        } catch {
          return;
        }
        const grant = this.grants.get(safeId);
        if (grant && grant.webContentsId === event.sender.id) {
          this.grants.delete(safeId);
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

        // Validate the id the same way the grant handler does so the Map keys match.
        // An unsafe id can never hold a grant, so treat it as unauthorized.
        let safeId: string;
        try {
          safeId = assertSafePluginId(pluginId);
        } catch {
          throw new Error('Plugin is not authorized for nodeExecution');
        }
        const grant = this.grants.get(safeId);
        if (
          !grant ||
          grant.token !== grantToken ||
          grant.webContentsId !== event.sender.id
        ) {
          throw new Error('Plugin is not authorized for nodeExecution');
        }

        return await this.executeScript(safeId, request);
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

  private mintGrant(pluginId: string, webContentsId: number): { token: string } {
    const token = randomBytes(32).toString('base64url');
    this.grants.set(pluginId, { token, webContentsId });
    return { token };
  }

  /**
   * Resolve the cleanly-verified built-in nodeExecution manifest for an id, or null
   * when the id does not resolve to one (no on-disk match, id mismatch, missing
   * permission, or unreadable/invalid manifest). A partial or colliding match must
   * never *upgrade* trust to the built-in dialog, so callers fall back to the
   * unverified-uploaded path on null.
   */
  private tryGetVerifiedBuiltInManifest(pluginId: string): PluginManifest | null {
    try {
      return this.getVerifiedBuiltInNodeExecutionManifest(pluginId);
    } catch {
      return null;
    }
  }

  /**
   * Consent dialog for a verified built-in plugin (name/version read from disk).
   * Built-in plugins are NOT persisted (Phase 2 ask-once is uploaded-only), so the copy
   * keeps the per-session wording.
   */
  private buildVerifiedBuiltInDialog(
    pluginId: string,
    manifest: PluginManifest,
  ): Electron.MessageBoxOptions {
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
   * The self-declared name/version exactly as shown in the uploaded-plugin consent dialog.
   * Single source of truth for the sanitize lengths and fallbacks, so the persisted record
   * (setNodeExecutionConsent) always matches what the user actually saw and approved.
   */
  private sanitizedUploadedDisplay(displayInfo?: NodeExecutionGrantDisplayInfo): {
    name: string;
    version: string;
  } {
    return {
      name: sanitizeDialogString(displayInfo?.name, 80) || '(unnamed)',
      version: sanitizeDialogString(displayInfo?.version, 32) || '(unknown)',
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
    const { name, version } = this.sanitizedUploadedDisplay(displayInfo);
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
        'If you allow it, the plugin can run any program with full access to your files and system.',
        'Your choice is remembered on this device until you disable, remove, or re-upload this plugin.',
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

      // Run the script with our own binary in node mode (ELECTRON_RUN_AS_NODE is set
      // below). In packaged builds the executable name doesn't contain "electron"
      // (e.g. "Super Productivity"), and the stripped child env has no PATH, so
      // falling back to spawn('node') fails with ENOENT unless node happens to live
      // in /usr/bin. process.execPath works in every mode: dev (Electron from
      // node_modules), packaged apps, and plain node (tests).
      const nodePath = process.execPath;

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
