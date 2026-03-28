import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { CalendarIntegrationEvent } from '../calendar-integration.model';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { Store } from '@ngrx/store';
import { selectIssueProviderById } from '../../issue/store/issue-provider.selectors';
import { firstValueFrom } from 'rxjs';
import { IssueProviderPluginType, isPluginIssueProvider } from '../../issue/issue.model';
import { SnackService } from '../../../core/snack/snack.service';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';

export interface CalendarEventEditDialogData {
  calendarEvent: CalendarIntegrationEvent;
}

@Component({
  selector: 'calendar-event-edit-dialog',
  templateUrl: './calendar-event-edit-dialog.component.html',
  styleUrl: './calendar-event-edit-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIconButton,
    MatIcon,
    MatFormField,
    MatLabel,
    MatInput,
    FormsModule,
    TranslatePipe,
    MsToStringPipe,
    LocaleDatePipe,
  ],
})
export class CalendarEventEditDialogComponent {
  T = T;
  private _dialogRef = inject(MatDialogRef<CalendarEventEditDialogComponent>);
  private _data: CalendarEventEditDialogData = inject(MAT_DIALOG_DATA);
  private _registry = inject(PluginIssueProviderRegistryService);
  private _pluginHttp = inject(PluginHttpService);
  private _store = inject(Store);
  private _snackService = inject(SnackService);

  readonly calendarEvent = this._data.calendarEvent;
  readonly isEditable =
    !!this.calendarEvent.issueProviderKey &&
    isPluginIssueProvider(this.calendarEvent.issueProviderKey as any);

  readonly isEditMode = signal(false);
  readonly isSaving = signal(false);
  readonly isDeleting = signal(false);

  // Editable fields
  title = this.calendarEvent.title;
  description = this.calendarEvent.description || '';

  close(): void {
    this._dialogRef.close();
  }

  toggleEditMode(): void {
    this.isEditMode.update((v) => !v);
  }

  async save(): Promise<void> {
    if (!this.isEditable || this.isSaving()) {
      return;
    }
    this.isSaving.set(true);
    try {
      const { http, pluginCfg, provider } = await this._getPluginContext();
      if (!provider?.definition.updateIssue) {
        return;
      }
      const changes: Record<string, unknown> = {};
      if (this.title !== this.calendarEvent.title) {
        changes.summary = this.title;
      }
      if (this.description !== (this.calendarEvent.description || '')) {
        changes.description = this.description;
      }
      if (Object.keys(changes).length > 0) {
        await provider.definition.updateIssue(
          this.calendarEvent.id,
          changes,
          pluginCfg.pluginConfig,
          http,
        );
        this._snackService.open({ type: 'SUCCESS', msg: T.F.CALENDARS.S.EVENT_UPDATED });
      }
      this._dialogRef.close('updated');
    } catch (e) {
      console.error('Failed to update calendar event', e);
      this.isSaving.set(false);
    }
  }

  async deleteEvent(): Promise<void> {
    if (!this.isEditable || this.isDeleting()) {
      return;
    }
    this.isDeleting.set(true);
    try {
      const { http, pluginCfg, provider } = await this._getPluginContext();
      if (!provider?.definition.deleteIssue) {
        return;
      }
      await provider.definition.deleteIssue(
        this.calendarEvent.id,
        pluginCfg.pluginConfig,
        http,
      );
      this._snackService.open({ type: 'SUCCESS', msg: T.F.CALENDARS.S.EVENT_DELETED });
      this._dialogRef.close('deleted');
    } catch (e) {
      console.error('Failed to delete calendar event', e);
      this.isDeleting.set(false);
    }
  }

  private async _getPluginContext(): Promise<{
    http: any;
    pluginCfg: IssueProviderPluginType;
    provider: any;
  }> {
    const pluginCfg = (await firstValueFrom(
      this._store.select(selectIssueProviderById(this.calendarEvent.calProviderId, null)),
    )) as IssueProviderPluginType;
    const provider = this._registry.getProvider(pluginCfg.issueProviderKey);
    const http = this._pluginHttp.createHttpHelper(() =>
      Promise.resolve(provider!.definition.getHeaders(pluginCfg.pluginConfig)),
    );
    return { http, pluginCfg, provider };
  }
}
