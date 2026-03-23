import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { T } from '../../../t.const';
import {
  IssueIntegrationCfg,
  IssueProvider,
  IssueProviderKey,
  IssueProviderTypeMap,
  BuiltInIssueProviderKey,
} from '../issue.model';
import {
  DEFAULT_ISSUE_PROVIDER_CFGS,
  ICAL_TYPE,
  ISSUE_PROVIDER_DEFAULT_COMMON_CFG,
  ISSUE_PROVIDER_FORM_CFGS_MAP,
  ISSUE_PROVIDER_HUMANIZED,
} from '../issue.const';
import { FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../config/global-config.model';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { IssueProviderActions } from '../store/issue-provider.actions';
import { NgClass } from '@angular/common';
import { OpenProjectAdditionalCfgComponent } from '../providers/open-project/open-project-view-components/openproject-cfg/open-project-additional-cfg.component';
import { nanoid } from 'nanoid';
import { HelperClasses, IS_ELECTRON, IS_WEB_BROWSER } from '../../../app.constants';
import { MatInputModule } from '@angular/material/input';
import { IssueService } from '../issue.service';
import { SnackService } from '../../../core/snack/snack.service';
import { CalendarContextInfoTarget } from '../providers/calendar/calendar.model';
import { IssueIconPipe } from '../issue-icon/issue-icon.pipe';
import { JiraAdditionalCfgComponent } from '../providers/jira/jira-view-components/jira-cfg/jira-additional-cfg.component';
import { HelpSectionComponent } from '../../../ui/help-section/help-section.component';
import { TranslatePipe } from '@ngx-translate/core';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { devError } from '../../../util/dev-error';
import { IssueLog } from '../../../core/log';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginBridgeService } from '../../../plugins/plugin-bridge.service';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { TrelloAdditionalCfgComponent } from '../providers/trello/trello-view-components/trello_cfg/trello_additional_cfg.component';
// ClickUp is now a plugin — no built-in config component needed
import { NextcloudDeckAdditionalCfgComponent } from '../providers/nextcloud-deck/nextcloud-deck-additional-cfg.component';
import { TaskService } from '../../tasks/task.service';
import { firstValueFrom } from 'rxjs';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../common-issue-form-stuff.const';

@Component({
  selector: 'dialog-edit-issue-provider',
  imports: [
    OpenProjectAdditionalCfgComponent,
    FormsModule,
    MatInputModule,
    NgClass,
    IssueIconPipe,
    JiraAdditionalCfgComponent,
    ReactiveFormsModule,
    MatDialogContent,
    HelpSectionComponent,
    TranslatePipe,
    MatSlideToggle,
    FormlyModule,
    MatDialogActions,
    MatButton,
    MatIcon,
    MatDialogTitle,
    TrelloAdditionalCfgComponent, // added for custom trello board loading support
    NextcloudDeckAdditionalCfgComponent,
  ],
  templateUrl: './dialog-edit-issue-provider.component.html',
  styleUrl: './dialog-edit-issue-provider.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogEditIssueProviderComponent {
  readonly T: typeof T = T;
  readonly HelperClasses = HelperClasses;
  readonly d = inject<{
    issueProvider?: IssueProvider;
    issueProviderKey?: IssueProviderKey;
    calendarContextInfoTarget?: CalendarContextInfoTarget;
    isDuplicate?: boolean;
  }>(MAT_DIALOG_DATA);

  isConnectionWorks = signal(false);
  isOAuthConnected = signal(false);
  isOAuthConnecting = signal(false);
  form = new FormGroup({});

  private _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private _pluginBridge = inject(PluginBridgeService);
  private _pluginHttp = inject(PluginHttpService);

  issueProviderKey: IssueProviderKey = (this.d.issueProvider?.issueProviderKey ||
    this.d.issueProviderKey) as IssueProviderKey;
  issueProvider?: IssueProvider = this.d.issueProvider;
  isEdit: boolean = !!this.issueProvider && !this.d.isDuplicate;

  model: Partial<IssueProvider> = this.isEdit
    ? { ...this.issueProvider }
    : this.d.isDuplicate && this.issueProvider
      ? { ...this.issueProvider, id: nanoid(), migratedFromProjectId: undefined }
      : ({
          ...ISSUE_PROVIDER_DEFAULT_COMMON_CFG,
          ...(this._pluginRegistry.hasProvider(this.issueProviderKey)
            ? {
                pluginId:
                  this._pluginRegistry.getProvider(this.issueProviderKey)?.pluginId ??
                  this.issueProviderKey.replace('plugin:', ''),
                pluginConfig: this._getDefaultPluginConfig(),
                isAutoAddToBacklog:
                  this._pluginRegistry.getProvider(this.issueProviderKey)
                    ?.defaultAutoAddToBacklog ?? false,
              }
            : DEFAULT_ISSUE_PROVIDER_CFGS[
                this.issueProviderKey as BuiltInIssueProviderKey
              ]),
          id: nanoid(),
          isEnabled: true,
          issueProviderKey: this.issueProviderKey,
        } as IssueProviderTypeMap<IssueProviderKey>);

  title: string = this._pluginRegistry.hasProvider(this.issueProviderKey)
    ? this._pluginRegistry.getName(this.issueProviderKey) || this.issueProviderKey
    : ISSUE_PROVIDER_HUMANIZED[this.issueProviderKey as BuiltInIssueProviderKey];

  configFormSection: ConfigFormSection<IssueIntegrationCfg> | undefined =
    this._pluginRegistry.hasProvider(this.issueProviderKey)
      ? this._getPluginFormSection()
      : ISSUE_PROVIDER_FORM_CFGS_MAP[this.issueProviderKey as BuiltInIssueProviderKey];

  fields = this.configFormSection?.items ?? [];

  oauthButtons = this._getOAuthButtons();

  private _matDialogRef: MatDialogRef<DialogEditIssueProviderComponent> =
    inject(MatDialogRef);

  private _matDialog = inject(MatDialog);
  private _store = inject(Store);
  private _issueService = inject(IssueService);
  private _snackService = inject(SnackService);
  private _taskService = inject(TaskService);

  constructor() {
    this._initOAuthAndOptions().catch((err) => {
      console.error('[DialogEditIssueProvider] OAuth init failed', err);
    });
  }

  submit(isSkipClose = false): void {
    if (this.form.valid) {
      if (this.isEdit) {
        this._store.dispatch(
          IssueProviderActions.updateIssueProvider({
            issueProvider: {
              id: this.issueProvider!.id,
              changes: this.model as IssueProvider,
            },
          }),
        );
      } else {
        this._store.dispatch(
          IssueProviderActions.addIssueProvider({
            issueProvider: this.model as IssueProvider,
          }),
        );
      }
      if (!isSkipClose) {
        this._matDialogRef.close(this.model);
      }
    }
  }

  cancel(): void {
    this._matDialogRef.close();
  }

  duplicate(): void {
    const providerData = structuredClone(this.model) as IssueProvider;
    this._matDialogRef.close();
    this._matDialog.open(DialogEditIssueProviderComponent, {
      restoreFocus: true,
      data: {
        issueProvider: providerData,
        isDuplicate: true,
      },
    });
  }

  formlyModelChange(model: Partial<IssueProvider>): void {
    this.updateModel(model);
  }

  customCfgCmpSave(cfgUpdates: IssueIntegrationCfg): void {
    IssueLog.log('customCfgCmpSave()', cfgUpdates);
    this.updateModel(cfgUpdates);
  }

  updateModel(model: Partial<IssueProvider>): void {
    // NOTE: this currently throws an error when loading issue point stuff for jira
    try {
      Object.keys(model).forEach((key) => {
        if (key !== 'isEnabled') {
          this.model![key] = model[key];
        }
      });
    } catch (e) {
      devError(e);
      const updates: any = {};
      Object.keys(model).forEach((key) => {
        if (key !== 'isEnabled') {
          updates[key] = model[key as keyof IssueProvider];
        }
      });
      this.model = { ...this.model, ...updates };
    }

    this.isConnectionWorks.set(false);
  }

  async testConnection(): Promise<void> {
    try {
      const isSuccess = await this._issueService.testConnection(
        this.model as IssueProvider,
      );
      this.isConnectionWorks.set(isSuccess);
      if (isSuccess) {
        this._snackService.open({
          type: 'SUCCESS',
          msg: T.F.ISSUE.S.CONNECTION_SUCCESS,
        });
      } else {
        this._snackService.open({
          type: 'ERROR',
          msg: T.F.ISSUE.S.CONNECTION_FAILED,
        });
      }
    } catch (error) {
      this.isConnectionWorks.set(false);
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.ISSUE.S.CONNECTION_FAILED,
      });
    }
  }

  remove(): void {
    this._matDialog
      .open(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          cancelTxt: T.G.CANCEL,
          okTxt: T.G.DELETE,
          message: T.F.ISSUE.DIALOG.DELETE_CONFIRM,
        },
      })
      .afterClosed()
      .subscribe(async (isConfirm: boolean) => {
        if (isConfirm) {
          const providerId = this.issueProvider!.id;

          // Gather task IDs to unlink - this ensures atomic sync
          const allTasks = await firstValueFrom(this._taskService.allTasks$);
          const taskIdsToUnlink = allTasks
            .filter((task) => task.issueProviderId === providerId)
            .map((task) => task.id);

          this._store.dispatch(
            TaskSharedActions.deleteIssueProvider({
              issueProviderId: providerId,
              taskIdsToUnlink,
            }),
          );
          this._matDialogRef.close();
        }
      });
  }

  changeEnabled(isEnabled: boolean): void {
    // this.model.isEnabled = isEnabled;
    this.model = {
      ...this.model,
      isEnabled,
    };
    this.submit(true);
    this.isConnectionWorks.set(false);
  }

  async connectOAuth(oauthConfig: {
    authUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret?: string;
    scopes: string[];
  }): Promise<void> {
    const pluginId = this._pluginRegistry.getProvider(this.issueProviderKey)?.pluginId;
    if (!pluginId) {
      return;
    }
    this.isOAuthConnecting.set(true);
    try {
      await this._pluginBridge.startOAuthFlow(pluginId, oauthConfig);
      this.isOAuthConnected.set(true);
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.ISSUE.S.OAUTH_CONNECTED,
      });
      await this._loadDynamicOptions();
    } catch (e) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.ISSUE.S.OAUTH_FAILED,
      });
    } finally {
      this.isOAuthConnecting.set(false);
    }
  }

  async disconnectOAuth(): Promise<void> {
    const pluginId = this._pluginRegistry.getProvider(this.issueProviderKey)?.pluginId;
    if (!pluginId) {
      return;
    }
    await this._pluginBridge.clearOAuthTokens(pluginId);
    this.isOAuthConnected.set(false);
  }

  protected readonly ICAL_TYPE = ICAL_TYPE;
  protected readonly IS_ANDROID_WEB_VIEW = IS_ANDROID_WEB_VIEW;
  protected readonly IS_ELECTRON = IS_ELECTRON;
  protected readonly IS_WEB_EXTENSION_REQUIRED_FOR_JIRA = IS_WEB_BROWSER;

  private async _loadDynamicOptions(): Promise<void> {
    const provider = this._pluginRegistry.getProvider(this.issueProviderKey);
    if (!provider) {
      return;
    }
    const configFields = this._pluginRegistry.getConfigFields(this.issueProviderKey);
    const dynamicFields = configFields.filter((f) => typeof f.loadOptions === 'function');
    if (!dynamicFields.length) {
      return;
    }

    const pluginConfig = (this.model as Record<string, unknown>)['pluginConfig'] ?? {};
    const http = this._pluginHttp.createHttpHelper(() =>
      provider.definition.getHeaders(pluginConfig as Record<string, unknown>),
    );

    for (const field of dynamicFields) {
      try {
        const options = await field.loadOptions!(
          pluginConfig as Record<string, unknown>,
          http,
        );
        const formlyField = this._findFormlyField(
          this.fields as FormlyFieldConfig[],
          'pluginConfig.' + field.key,
        );
        if (formlyField?.templateOptions) {
          formlyField.templateOptions.options = options;
        } else if (formlyField?.props) {
          formlyField.props.options = options;
        }
      } catch (e) {
        console.error(
          `[DialogEditIssueProvider] loadOptions failed for field '${field.key}':`,
          e,
        );
        this._snackService.open({
          type: 'ERROR',
          msg: T.F.ISSUE.S.LOAD_OPTIONS_FAILED,
          translateParams: { fieldKey: field.key },
        });
      }
    }
    // Trigger formly refresh
    this.fields = [...this.fields];
  }

  private _findFormlyField(
    fields: FormlyFieldConfig[],
    key: string,
  ): FormlyFieldConfig | undefined {
    for (const f of fields) {
      if (f.key === key) {
        return f;
      }
      if (f.fieldGroup) {
        const found = this._findFormlyField(f.fieldGroup, key);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  }

  private _getDefaultPluginConfig(): Record<string, unknown> {
    if (!this._pluginRegistry.hasProvider(this.issueProviderKey)) {
      return {};
    }
    const fieldMappings = this._pluginRegistry.getFieldMappings(this.issueProviderKey);
    if (!fieldMappings?.length) {
      return {};
    }
    const twoWaySync: Record<string, string> = {};
    for (const m of fieldMappings) {
      twoWaySync[m.taskField] = m.defaultDirection;
    }
    return { twoWaySync };
  }

  private _getPluginFormSection(): ConfigFormSection<IssueIntegrationCfg> | undefined {
    const pluginKey = this.issueProviderKey;
    const configFields = this._pluginRegistry.getConfigFields(pluginKey);
    const fieldMappings = this._pluginRegistry.getFieldMappings(pluginKey);
    if (!configFields?.length && !fieldMappings?.length) {
      return undefined;
    }

    const regularFields = configFields.filter(
      (f) => !f.advanced && f.type !== 'oauthButton',
    );
    const advancedFields = configFields.filter(
      (f) => f.advanced && f.type !== 'oauthButton',
    );

    const items = regularFields.map((f) =>
      this._mapPluginConfigField(f),
    ) as LimitedFormlyFieldConfig<IssueIntegrationCfg>[];

    items.push({
      type: 'collapsible' as any,
      props: { label: T.F.ISSUE.DIALOG.ADVANCED_CONFIG },
      fieldGroup: [
        ...(ISSUE_PROVIDER_COMMON_FORM_FIELDS as any[]),
        ...advancedFields.map((f) => this._mapPluginConfigField(f)),
      ],
    } as any);

    if (fieldMappings?.length) {
      items.push(this._buildTwoWaySyncSection(pluginKey, fieldMappings) as any);
    }

    return {
      title: this.title,
      key: 'EMPTY' as ConfigFormSection<IssueIntegrationCfg>['key'],
      items,
    };
  }

  private _mapPluginConfigField(f: {
    key: string;
    type: string;
    label: string;
    required?: boolean;
    description?: string;
    url?: string;
    pattern?: string;
    options?: { value: string; label: string }[];
  }): unknown {
    if (f.type === 'link') {
      return {
        type: 'link',
        props: { url: f.url ?? f.key, txt: f.label },
      };
    }
    const formlyType =
      f.type === 'checkbox'
        ? 'checkbox'
        : f.type === 'select'
          ? 'select'
          : f.type === 'textarea'
            ? 'textarea'
            : 'input';
    return {
      key: ('pluginConfig.' + f.key) as keyof IssueIntegrationCfg,
      type: formlyType,
      templateOptions: {
        label: f.label,
        required: f.required ?? false,
        ...(f.description ? { description: f.description } : {}),
        ...(f.type === 'password' ? { type: 'password' } : {}),
        ...(f.type === 'select' ? { options: f.options } : {}),
        ...(f.pattern ? { pattern: f.pattern } : {}),
      },
    };
  }

  private _buildTwoWaySyncSection(
    pluginKey: IssueProviderKey,
    fieldMappings: { taskField: string; issueField: string; defaultDirection: string }[],
  ): unknown {
    const syncDirectionOptions = [
      { value: 'off', label: T.F.ISSUE.TWO_WAY_SYNC.OFF },
      { value: 'pullOnly', label: T.F.ISSUE.TWO_WAY_SYNC.PULL_ONLY },
      { value: 'pushOnly', label: T.F.ISSUE.TWO_WAY_SYNC.PUSH_ONLY },
      { value: 'both', label: T.F.ISSUE.TWO_WAY_SYNC.BOTH },
    ];
    const TASK_FIELD_LABELS: Record<string, string> = {
      isDone: T.F.ISSUE.TWO_WAY_SYNC.STATUS,
      title: T.F.ISSUE.TWO_WAY_SYNC.TITLE,
      notes: T.F.ISSUE.TWO_WAY_SYNC.NOTES,
      dueDay: T.F.ISSUE.TWO_WAY_SYNC.DUE_DAY,
      dueWithTime: T.F.ISSUE.TWO_WAY_SYNC.DUE_WITH_TIME,
      timeEstimate: T.F.ISSUE.TWO_WAY_SYNC.TIME_ESTIMATE,
    };
    const syncFields: any[] = fieldMappings.map((m) => ({
      key: ('pluginConfig.twoWaySync.' + m.taskField) as keyof IssueIntegrationCfg,
      type: 'select' as const,
      props: {
        label: TASK_FIELD_LABELS[m.taskField] ?? m.taskField,
        options: syncDirectionOptions,
      },
    }));
    const provider = this._pluginRegistry.getProvider(pluginKey);
    if (provider?.definition.createIssue) {
      syncFields.push({
        key: 'pluginConfig.isAutoCreateIssues',
        type: 'checkbox',
        expressions: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'props.disabled': '!model.defaultProjectId',
        },
        props: {
          label: T.F.ISSUE.TWO_WAY_SYNC.AUTO_CREATE_ISSUES,
          description: T.F.ISSUE.TWO_WAY_SYNC.AUTO_CREATE_ISSUES_DESCRIPTION,
        },
      });
    }
    return {
      type: 'collapsible',
      props: { label: T.F.ISSUE.TWO_WAY_SYNC.SECTION },
      fieldGroup: syncFields,
    };
  }

  private _getOAuthButtons(): {
    label: string;
    oauthConfig: {
      authUrl: string;
      tokenUrl: string;
      clientId: string;
      clientSecret?: string;
      scopes: string[];
    };
  }[] {
    if (!this._pluginRegistry.hasProvider(this.issueProviderKey)) {
      return [];
    }
    const configFields = this._pluginRegistry.getConfigFields(this.issueProviderKey);
    return configFields
      .filter((f) => f.type === 'oauthButton' && f.oauthConfig)
      .map((f) => ({ label: f.label, oauthConfig: f.oauthConfig! }));
  }

  private async _initOAuthAndOptions(): Promise<void> {
    const provider = this._pluginRegistry.getProvider(this.issueProviderKey);
    if (!provider) {
      return;
    }
    const hasTokens = await this._pluginBridge.restoreAndCheckOAuthTokens(
      provider.pluginId,
    );
    this.isOAuthConnected.set(hasTokens);
    if (hasTokens) {
      await this._loadDynamicOptions();
    }
  }
}
