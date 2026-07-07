import { Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  RegisteredPluginIssueProvider,
  IssueProviderPluginDefinition,
  PluginIssueField,
  PluginCommentsConfig,
  PluginFieldMapping,
} from './plugin-issue-provider.model';
import { IssueProviderKey } from '../../features/issue/issue.model';
import { PluginLog } from '../../core/log';

@Injectable({ providedIn: 'root' })
export class PluginIssueProviderRegistryService {
  private _providers = new Map<string, RegisteredPluginIssueProvider>();

  /** Maps pluginId → registeredKey for cleanup */
  private _pluginIdToKey = new Map<string, string>();

  /**
   * Single source of truth for "a plugin (un)registered", exposed two ways so signal-
   * and stream-based consumers react to the same event without drifting:
   * - `registrationChanges$` (RxJS) for observable pipelines that must re-run without an
   *   effect/CD flush AND emit synchronously on subscribe — e.g.
   *   `CalendarIntegrationService.calendarEvents$`. (A `toObservable(signal)` only emits
   *   once its effect runs, delaying even the initial value; a `BehaviorSubject` does not.)
   * - `registrationVersion` (signal) for `computed()` consumers, e.g. `tag-list`.
   */
  private readonly _registrationVersion$ = new BehaviorSubject(0);
  readonly registrationChanges$: Observable<number> =
    this._registrationVersion$.asObservable();
  readonly registrationVersion = toSignal(this._registrationVersion$, {
    requireSync: true,
  });

  register(opts: {
    pluginId: string;
    definition: IssueProviderPluginDefinition;
    name: string;
    humanReadableName: string;
    icon: string;
    pollIntervalMs: number;
    issueStrings: { singular: string; plural: string };
    issueProviderKey?: string;
    useAgendaView?: boolean;
    defaultAutoAddToBacklog?: boolean;
    allowPrivateNetwork?: boolean;
  }): void {
    const key = opts.issueProviderKey ?? `plugin:${opts.pluginId}`;
    if (this._providers.has(key)) {
      PluginLog.warn(
        `[PluginIssueProviderRegistry] Duplicate registration for '${key}', ignoring.`,
      );
      return;
    }
    this._providers.set(key, {
      pluginId: opts.pluginId,
      registeredKey: key as IssueProviderKey,
      definition: opts.definition,
      name: opts.name,
      humanReadableName: opts.humanReadableName,
      icon: opts.icon,
      pollIntervalMs: opts.pollIntervalMs,
      issueStrings: opts.issueStrings,
      useAgendaView: opts.useAgendaView,
      defaultAutoAddToBacklog: opts.defaultAutoAddToBacklog,
      allowPrivateNetwork: opts.allowPrivateNetwork,
    });
    this._pluginIdToKey.set(opts.pluginId, key);
    this._bumpRegistrationVersion();
  }

  unregister(pluginId: string): void {
    const key = this._pluginIdToKey.get(pluginId);
    if (key) {
      this._providers.delete(key);
      this._pluginIdToKey.delete(pluginId);
      this._bumpRegistrationVersion();
    }
  }

  /** Advance the single registration counter; both `registrationChanges$` and the
   * derived `registrationVersion` signal update from it. */
  private _bumpRegistrationVersion(): void {
    this._registrationVersion$.next(this._registrationVersion$.value + 1);
  }

  /** Get the registered key for a pluginId (e.g. 'GITHUB' or 'plugin:my-plugin') */
  getRegisteredKey(pluginId: string): string | undefined {
    return this._pluginIdToKey.get(pluginId);
  }

  getProvider(key: string): RegisteredPluginIssueProvider | undefined {
    return this._providers.get(key);
  }

  hasProvider(key: string): boolean {
    return this._providers.has(key);
  }

  getAvailableProviders(): RegisteredPluginIssueProvider[] {
    return Array.from(this._providers.values());
  }

  getIcon(key: string): string {
    return this._providers.get(key)?.icon ?? 'extension';
  }

  getName(key: string): string {
    return this._providers.get(key)?.name ?? 'Plugin';
  }

  getHumanReadableName(key: string): string {
    return this._providers.get(key)?.humanReadableName ?? 'Plugin';
  }

  getIssueStrings(key: string): {
    ISSUE_STR: string;
    ISSUES_STR: string;
  } {
    const p = this._providers.get(key);
    return {
      ISSUE_STR: p?.issueStrings.singular ?? 'Issue',
      ISSUES_STR: p?.issueStrings.plural ?? 'Issues',
    };
  }

  getPollIntervalMs(key: string): number {
    return this._providers.get(key)?.pollIntervalMs ?? 0;
  }

  getIssueDisplay(key: string): PluginIssueField[] {
    return this._providers.get(key)?.definition.issueDisplay ?? [];
  }

  getConfigFields(key: string): IssueProviderPluginDefinition['configFields'] {
    return this._providers.get(key)?.definition.configFields ?? [];
  }

  getCommentsConfig(key: string): PluginCommentsConfig | undefined {
    return this._providers.get(key)?.definition.commentsConfig;
  }

  getFieldMappings(key: string): PluginFieldMapping[] | undefined {
    return this._providers.get(key)?.definition.fieldMappings;
  }

  getUseAgendaView(key: string): boolean {
    return this._providers.get(key)?.useAgendaView ?? false;
  }
}
