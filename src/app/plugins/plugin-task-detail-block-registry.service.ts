import { Injectable, signal } from '@angular/core';
import type { PluginTaskDetailBlockCfg } from '@super-productivity/plugin-api';

interface RegisteredTaskDetailBlock extends PluginTaskDetailBlockCfg {
  pluginId: string;
}

@Injectable({ providedIn: 'root' })
export class PluginTaskDetailBlockRegistryService {
  private readonly _blocks = signal<RegisteredTaskDetailBlock[]>([]);
  readonly blocks = this._blocks.asReadonly();

  bind(
    pluginId: string,
    hasIframe: boolean,
  ): {
    registerTaskDetailBlock: (cfg: PluginTaskDetailBlockCfg) => void;
  } {
    return {
      registerTaskDetailBlock: (cfg) => {
        if (!hasIframe) {
          throw new Error(
            'Task detail blocks require iFrame: true in the plugin manifest',
          );
        }
        this.register(pluginId, cfg);
      },
    };
  }

  register(pluginId: string, cfg: PluginTaskDetailBlockCfg): void {
    const id = typeof cfg?.id === 'string' ? cfg.id : '';
    const label = typeof cfg?.label === 'string' ? cfg.label.trim() : '';
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || !label || label.length > 80) {
      throw new Error(
        'Task detail block requires a valid ID and a label of 1–80 characters',
      );
    }

    const block = { pluginId, id, label };
    this._blocks.update((blocks) =>
      blocks.some((item) => item.pluginId === pluginId && item.id === id)
        ? blocks.map((item) =>
            item.pluginId === pluginId && item.id === id ? block : item,
          )
        : [...blocks, block],
    );
  }

  unregisterPlugin(pluginId: string): void {
    this._blocks.update((blocks) =>
      blocks.filter((block) => block.pluginId !== pluginId),
    );
  }
}
