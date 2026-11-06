import { PluginAPI } from '@super-productivity/plugin-api';
import { AutomationRule } from '../types';

const FALLBACK_SHORTCUT_LABEL = 'Unnamed automation rule';

const labelFor = (ruleName: string): string => ruleName.trim() || FALLBACK_SHORTCUT_LABEL;

/**
 * Keeps the host's plugin shortcut list in sync with the rules that use the
 * "shortcut" trigger.
 *
 * The host stores the key the user picked under `plugin_<pluginId>:<shortcutId>`,
 * so the shortcut id has to stay stable for the lifetime of a rule — we use the
 * rule id, which means renaming a rule keeps its key binding.
 *
 * Only enabled rules are registered: a registered shortcut swallows its key
 * combo in the host, so a disabled rule must not keep the key occupied.
 */
export class ShortcutBinder {
  // ruleId -> last registered label, so we only re-register on actual changes.
  private registeredLabels = new Map<string, string>();

  constructor(
    private plugin: PluginAPI,
    private onExec: (ruleId: string) => void,
  ) {}

  sync(rules: AutomationRule[]): void {
    const shortcutRules = rules.filter((r) => r.trigger.type === 'shortcut' && r.isEnabled);
    const activeIds = new Set(shortcutRules.map((r) => r.id));

    for (const ruleId of [...this.registeredLabels.keys()]) {
      if (!activeIds.has(ruleId)) {
        this.unregister(ruleId);
      }
    }

    for (const { id, name } of shortcutRules) {
      const label = labelFor(name);
      if (this.registeredLabels.get(id) === label) continue;

      // Capture only the id: the host holds onExec for the lifetime of the
      // registration, so closing over the rule would pin a stale copy of it.
      this.plugin.registerShortcut({ id, label, onExec: () => this.onExec(id) });
      this.registeredLabels.set(id, label);
    }
  }

  private unregister(ruleId: string): void {
    this.plugin.unregisterShortcut(ruleId);
    this.registeredLabels.delete(ruleId);
  }
}
