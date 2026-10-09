import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { T } from '../../../t.const';
import { MatIcon } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { IssueProviderKey, isValidIssueProviderKey } from '../../issue/issue.model';
import { DialogEditIssueProviderComponent } from '../../issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { CalendarContextInfoTarget } from '../../issue/providers/calendar/calendar.model';
import { selectEnabledIssueProviders } from '../../issue/store/issue-provider.selectors';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginService } from '../../../plugins/plugin.service';
import { IssueLog } from '../../../core/log';

@Component({
  selector: 'issue-provider-setup-overview',
  imports: [MatIcon, TranslateModule],
  templateUrl: './issue-provider-setup-overview.component.html',
  styleUrl: './issue-provider-setup-overview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssueProviderSetupOverviewComponent {
  protected readonly T = T;
  private _store = inject(Store);
  private _matDialog = inject(MatDialog);
  private _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private _pluginService = inject(PluginService);

  enabledProviders$ = this._store.select(selectEnabledIssueProviders);
  // Plugins are discovered after the initial sync, which can finish after this panel
  // opened, so the lists follow the registry and plugin-state signals.
  private _registeredProviders = computed(() => {
    this._pluginRegistry.registrationVersion();
    return this._pluginRegistry.getAvailableProviders();
  });
  private _disabledProviders = computed(() =>
    this._pluginService.getDisabledIssueProviderPlugins(),
  );
  pluginProviders = computed(() =>
    this._registeredProviders().filter((p) => !p.useAgendaView),
  );
  pluginCalendarProviders = computed(() =>
    this._registeredProviders().filter((p) => p.useAgendaView),
  );
  disabledPluginProviders = computed(() =>
    this._disabledProviders().filter((p) => !p.useAgendaView),
  );
  disabledPluginCalendarProviders = computed(() =>
    this._disabledProviders().filter((p) => p.useAgendaView),
  );

  openSetupDialog(
    issueProviderKey: IssueProviderKey,
    calendarContextInfoTarget?: CalendarContextInfoTarget,
  ): void {
    this._matDialog.open(DialogEditIssueProviderComponent, {
      restoreFocus: true,
      data: {
        issueProviderKey,
        calendarContextInfoTarget,
      },
    });
  }

  async enablePluginAndOpenSetup(
    pluginId: string,
    issueProviderKey: string,
  ): Promise<void> {
    await this._pluginService.enableAndActivatePlugin(pluginId);
    if (!isValidIssueProviderKey(issueProviderKey)) {
      IssueLog.err(`Invalid issue provider key from plugin: "${issueProviderKey}"`);
      return;
    }
    this.openSetupDialog(issueProviderKey);
  }
}
