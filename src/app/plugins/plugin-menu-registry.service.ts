import { inject, Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { PluginMenuEntryCfg, PluginTaskContextMenuEntryCfg } from './plugin-api.model';
import { T } from '../t.const';
import { PluginLog } from '../core/log';

type EntryCfg = Omit<PluginMenuEntryCfg | PluginTaskContextMenuEntryCfg, 'pluginId'>;

/**
 * Menu entries registered by plugins: side-nav entries (`registerMenuEntry`)
 * and task context menu entries (`registerTaskContextMenuEntry`). Split out of
 * PluginBridgeService, which is over the service size cap; the bridge wires
 * the per-plugin bound methods and removes a plugin's entries on unload.
 */
@Injectable({
  providedIn: 'root',
})
export class PluginMenuRegistryService {
  private readonly _translateService = inject(TranslateService);

  private readonly _menuEntries = signal<PluginMenuEntryCfg[]>([]);
  readonly menuEntries = this._menuEntries.asReadonly();

  // Read only by the task context menu, which is created on demand when opened,
  // so this stays off the per-task render path.
  private readonly _taskContextMenuEntries = signal<PluginTaskContextMenuEntryCfg[]>([]);
  readonly taskContextMenuEntries = this._taskContextMenuEntries.asReadonly();

  registerMenuEntry(
    pluginId: string,
    menuEntryCfg: Omit<PluginMenuEntryCfg, 'pluginId'>,
  ): void {
    this._assertValidEntryCfg(menuEntryCfg);
    if (this._isDuplicate(this._menuEntries(), pluginId, menuEntryCfg)) {
      return;
    }
    this._menuEntries.update((entries) => [...entries, { ...menuEntryCfg, pluginId }]);
    PluginLog.log('PluginBridge: Menu entry registered', {
      pluginId,
      label: menuEntryCfg.label,
    });
  }

  registerTaskContextMenuEntry(
    pluginId: string,
    cfg: Omit<PluginTaskContextMenuEntryCfg, 'pluginId'>,
  ): void {
    this._assertValidEntryCfg(cfg);
    if (this._isDuplicate(this._taskContextMenuEntries(), pluginId, cfg)) {
      return;
    }
    this._taskContextMenuEntries.update((entries) => [...entries, { ...cfg, pluginId }]);
    PluginLog.log('PluginBridge: Task context menu entry registered', {
      pluginId,
      label: cfg.label,
    });
  }

  /**
   * Run a task context menu entry. A plugin's error stays the plugin's: it is
   * logged instead of reaching the global error handler, whose crash dialog
   * would invite bug reports against the app for a plugin's bug.
   */
  runTaskContextMenuEntry(entry: PluginTaskContextMenuEntryCfg, taskId: string): void {
    const logError = (e: unknown): void =>
      PluginLog.err('PluginBridge: Task context menu entry failed', {
        pluginId: entry.pluginId,
        error: e instanceof Error ? e.name : typeof e,
      });
    try {
      const result: unknown = entry.onClick(taskId);
      if (result instanceof Promise) {
        result.catch(logError);
      }
    } catch (e) {
      logError(e);
    }
  }

  /** Remove every menu entry a plugin registered (on disable/unload). */
  removePluginEntries(pluginId: string): void {
    this._menuEntries.update((entries) => entries.filter((e) => e.pluginId !== pluginId));
    this._taskContextMenuEntries.update((entries) =>
      entries.filter((e) => e.pluginId !== pluginId),
    );
    PluginLog.log('PluginBridge: Menu entries removed for plugin', { pluginId });
  }

  // Validate required fields manually since typia has issues with optional fields
  private _assertValidEntryCfg(cfg: EntryCfg): void {
    if (!cfg.label || typeof cfg.label !== 'string') {
      throw new Error(
        this._translateService.instant(T.PLUGINS.MENU_ENTRY_LABEL_REQUIRED),
      );
    }
    if (!cfg.onClick || typeof cfg.onClick !== 'function') {
      throw new Error(
        this._translateService.instant(T.PLUGINS.MENU_ENTRY_ONCLICK_REQUIRED),
      );
    }
    if (cfg.icon !== undefined && typeof cfg.icon !== 'string') {
      throw new Error(this._translateService.instant(T.PLUGINS.MENU_ENTRY_ICON_STRING));
    }
  }

  // Same plugin + label is a duplicate; keep the first registration.
  private _isDuplicate(
    entries: { pluginId: string; label: string }[],
    pluginId: string,
    cfg: EntryCfg,
  ): boolean {
    const isDuplicate = entries.some(
      (e) => e.pluginId === pluginId && e.label === cfg.label,
    );
    if (isDuplicate) {
      PluginLog.err(
        'PluginBridge: Duplicate menu entry detected, skipping registration',
        {
          pluginId,
          label: cfg.label,
        },
      );
    }
    return isDuplicate;
  }
}
