import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { T } from '../../../t.const';
import { MatIcon } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { IssueProviderKey, isValidIssueProviderKey } from '../../issue/issue.model';
import { DialogEditIssueProviderComponent } from '../../issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { CalendarContextInfoTarget } from '../../issue/providers/calendar/calendar.model';
import { selectEnabledIssueProviders } from '../../issue/store/issue-provider.selectors';
import { MatButton } from '@angular/material/button';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginService } from '../../../plugins/plugin.service';

@Component({
  selector: 'issue-provider-setup-overview',
  imports: [MatIcon, TranslateModule, MatButton],
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
  // NOTE: intentionally non-reactive for v1 — plugins load at startup before this dialog opens
  pluginProviders = this._pluginRegistry
    .getAvailableProviders()
    .filter((p) => !p.useAgendaView);
  pluginCalendarProviders = this._pluginRegistry
    .getAvailableProviders()
    .filter((p) => p.useAgendaView);
  disabledPluginProviders = this._pluginService
    .getDisabledIssueProviderPlugins()
    .filter((p) => !p.useAgendaView);
  disabledPluginCalendarProviders = this._pluginService
    .getDisabledIssueProviderPlugins()
    .filter((p) => p.useAgendaView);

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
    // Remove from disabled lists and refresh enabled lists
    this.disabledPluginProviders = this.disabledPluginProviders.filter(
      (p) => p.pluginId !== pluginId,
    );
    this.disabledPluginCalendarProviders = this.disabledPluginCalendarProviders.filter(
      (p) => p.pluginId !== pluginId,
    );
    const allProviders = this._pluginRegistry.getAvailableProviders();
    this.pluginProviders = allProviders.filter((p) => !p.useAgendaView);
    this.pluginCalendarProviders = allProviders.filter((p) => p.useAgendaView);
    if (!isValidIssueProviderKey(issueProviderKey)) {
      console.error(`Invalid issue provider key from plugin: "${issueProviderKey}"`);
      return;
    }
    this.openSetupDialog(issueProviderKey);
  }
}
