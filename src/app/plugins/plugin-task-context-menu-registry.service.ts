import { inject, Injectable, signal } from '@angular/core';
import {
  PluginTaskContextMenuContext,
  PluginTaskContextMenuEntryCfg,
  PluginTaskContextMenuTarget,
} from '@super-productivity/plugin-api';
import { TranslateService } from '@ngx-translate/core';
import { PluginLog } from '../core/log';
import { T } from '../t.const';

const ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ICON_PATTERN = /^[a-z0-9_]{1,64}$/;
const MAX_LABEL_LENGTH = 80;
const DEFAULT_TARGETS: readonly PluginTaskContextMenuTarget[] = ['TASK', 'SUBTASK'];
const VALID_TARGETS = new Set<PluginTaskContextMenuTarget>(DEFAULT_TARGETS);

interface RegisteredTaskContextMenuEntry {
  pluginId: string;
  pluginName: string;
  id: string;
  label: string;
  icon?: string;
  showFor: readonly PluginTaskContextMenuTarget[];
  onClick: (context: PluginTaskContextMenuContext) => void | Promise<void>;
}

export interface PluginTaskContextMenuEntryView {
  readonly pluginId: string;
  readonly pluginName: string;
  readonly entryId: string;
  readonly label: string;
  readonly icon?: string;
}

@Injectable({ providedIn: 'root' })
export class PluginTaskContextMenuRegistryService {
  private readonly _entries = signal<RegisteredTaskContextMenuEntry[]>([]);
  private readonly _translateService = inject(TranslateService);

  register(
    pluginId: string,
    pluginName: string,
    cfg: PluginTaskContextMenuEntryCfg,
  ): void {
    const id = typeof cfg.id === 'string' ? cfg.id.trim() : '';
    const label = typeof cfg.label === 'string' ? cfg.label.trim() : '';
    if (!ENTRY_ID_PATTERN.test(id)) {
      throw new Error(
        this._translateService.instant(T.PLUGINS.TASK_CONTEXT_MENU_ENTRY_ID_INVALID),
      );
    }
    if (!label || label.length > MAX_LABEL_LENGTH) {
      throw new Error(
        this._translateService.instant(T.PLUGINS.TASK_CONTEXT_MENU_ENTRY_LABEL_INVALID, {
          maxLength: MAX_LABEL_LENGTH,
        }),
      );
    }
    if (
      cfg.icon !== undefined &&
      (typeof cfg.icon !== 'string' || !ICON_PATTERN.test(cfg.icon))
    ) {
      throw new Error(
        this._translateService.instant(T.PLUGINS.TASK_CONTEXT_MENU_ENTRY_ICON_INVALID),
      );
    }
    if (typeof cfg.onClick !== 'function') {
      throw new Error(
        this._translateService.instant(
          T.PLUGINS.TASK_CONTEXT_MENU_ENTRY_ONCLICK_REQUIRED,
        ),
      );
    }

    const showFor = cfg.showFor?.length ? [...new Set(cfg.showFor)] : DEFAULT_TARGETS;
    if (showFor.some((target) => !VALID_TARGETS.has(target))) {
      throw new Error(
        this._translateService.instant(T.PLUGINS.TASK_CONTEXT_MENU_ENTRY_TARGET_INVALID),
      );
    }

    const newEntry: RegisteredTaskContextMenuEntry = {
      pluginId,
      pluginName,
      id,
      label,
      icon: cfg.icon,
      showFor,
      onClick: cfg.onClick,
    };
    const withoutPrevious = this._entries().filter(
      (entry) => entry.pluginId !== pluginId || entry.id !== id,
    );
    this._entries.set([...withoutPrevious, newEntry]);
    PluginLog.log('Plugin task context menu entry registered', { pluginId, entryId: id });
  }

  entriesFor(target: PluginTaskContextMenuTarget): PluginTaskContextMenuEntryView[] {
    return this._entries()
      .filter((entry) => entry.showFor.includes(target))
      .sort((a, b) => a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id))
      .map((entry) => ({
        pluginId: entry.pluginId,
        pluginName: entry.pluginName,
        entryId: entry.id,
        label: entry.label,
        icon: entry.icon,
      }));
  }

  async execute(pluginId: string, entryId: string, taskId: string): Promise<void> {
    const entry = this._entries().find(
      (candidate) => candidate.pluginId === pluginId && candidate.id === entryId,
    );
    if (!entry) {
      return;
    }

    try {
      await entry.onClick(Object.freeze({ taskId }));
    } catch (error) {
      PluginLog.err(
        'Plugin task context menu action failed',
        {
          pluginId,
          entryId,
          taskId,
        },
        error,
      );
    }
  }

  unregisterPlugin(pluginId: string): void {
    this._entries.set(this._entries().filter((entry) => entry.pluginId !== pluginId));
  }
}
