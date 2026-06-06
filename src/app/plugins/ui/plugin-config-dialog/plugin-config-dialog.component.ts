import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FormlyJsonschema } from '@ngx-formly/core/json-schema';
import { JSONSchema7 } from 'json-schema';
import { PluginManifest } from '../../plugin-api.model';
import { PluginUserPersistenceService } from '../../plugin-user-persistence.service';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { PluginLog } from '../../../core/log';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatError } from '@angular/material/form-field';

export interface PluginConfigDialogData {
  manifest: PluginManifest;
  schema: JSONSchema7;
}

interface PluginConfigData {
  config: Record<string, unknown>;
  savedAt: number;
}

@Component({
  selector: 'plugin-config-dialog',
  template: `
    <div mat-dialog-title>
      {{ manifest.name }} {{ _translateService.instant(T.PLUGINS.CONFIGURATION) }}
    </div>

    <mat-dialog-content>
      @if (loading()) {
        <div class="loading-container">
          <mat-spinner diameter="40"></mat-spinner>
        </div>
      } @else if (error()) {
        <mat-error>
          <mat-icon>error</mat-icon>
          {{ error() }}
        </mat-error>
      } @else {
        <form [formGroup]="form">
          <formly-form
            [form]="form"
            [fields]="fields"
            [model]="model"
            (modelChange)="model = $event"
          ></formly-form>
        </form>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button
        mat-button
        (click)="onCancel()"
        [disabled]="loading()"
      >
        {{ _translateService.instant(T.G.CANCEL) }}
      </button>
      <button
        mat-button
        color="primary"
        (click)="onSave()"
        [disabled]="!form.valid || loading()"
      >
        <mat-icon>save</mat-icon>
        {{ _translateService.instant(T.G.SAVE) }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      mat-dialog-content {
        min-width: 400px;
        max-width: 600px;
        max-height: 600px;
        overflow-y: auto;
      }

      mat-dialog-actions {
        gap: 8px;
      }

      mat-icon {
        margin-right: 8px;
      }

      .loading-container {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 40px;
      }

      mat-error {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 16px;
      }

      form {
        padding: 16px 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButton,
    MatIcon,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    MatProgressSpinner,
    MatError,
    ReactiveFormsModule,
    FormlyModule,
  ],
})
export class PluginConfigDialogComponent {
  private readonly _dialogRef = inject(MatDialogRef<PluginConfigDialogComponent>);
  private readonly _pluginUserPersistenceService = inject(PluginUserPersistenceService);
  private readonly _formlyJsonschema = inject(FormlyJsonschema);
  readonly _translateService = inject(TranslateService);

  readonly T = T;
  readonly manifest: PluginManifest;
  readonly schema: JSONSchema7;

  form = new FormGroup({});
  model: Record<string, unknown> = {};
  fields: FormlyFieldConfig[] = [];

  loading = signal(true);
  error = signal<string | null>(null);

  data = inject<PluginConfigDialogData>(MAT_DIALOG_DATA);

  constructor() {
    this.manifest = this.data.manifest;
    this.schema = this.data.schema;

    this.initializeForm();
  }

  private async initializeForm(): Promise<void> {
    try {
      // Convert JSON schema to formly fields with type mapping
      const fieldConfig = this._formlyJsonschema.toFieldConfig(this.schema);

      // Extract fields for the root object
      if (this.schema.type === 'object' && fieldConfig.fieldGroup) {
        this.fields = fieldConfig.fieldGroup;
      } else {
        this.fields = [fieldConfig];
      }

      // Load existing configuration
      const existingConfig = await this._pluginUserPersistenceService.loadPluginUserData(
        this.manifest.id,
      );

      if (existingConfig) {
        try {
          const parsedConfig = JSON.parse(existingConfig) as PluginConfigData;
          // Only use the config part, not the full persistence object
          this.model = parsedConfig.config || {};
        } catch (e) {
          PluginLog.warn(
            `Failed to parse existing config for plugin ${this.manifest.id}`,
            e,
          );
          this.model = {};
        }
      }

      this.loading.set(false);
    } catch (error) {
      PluginLog.err('Failed to initialize plugin config form:', error);
      this.error.set(this._translateService.instant(T.PLUGINS.FAILED_TO_LOAD_CONFIG));
      this.loading.set(false);
    }
  }

  async onSave(): Promise<void> {
    if (!this.form.valid) {
      return;
    }

    this.loading.set(true);
    try {
      // Save the configuration
      const configData: PluginConfigData = {
        config: this.model,
        savedAt: Date.now(),
      };

      await this._pluginUserPersistenceService.persistPluginUserData(
        this.manifest.id,
        JSON.stringify(configData),
      );

      PluginLog.log(`Saved config for plugin ${this.manifest.id}`);
      this._dialogRef.close(true);
    } catch (error) {
      PluginLog.err('Failed to save plugin config:', error);
      this.error.set(this._translateService.instant(T.PLUGINS.FAILED_TO_SAVE_CONFIG));
      this.loading.set(false);
    }
  }

  onCancel(): void {
    this._dialogRef.close(false);
  }
}
