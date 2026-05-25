import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { PluginManifest } from '../../plugin-api.model';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatCheckbox } from '@angular/material/checkbox';
import {
  MatDialogTitle,
  MatDialogContent,
  MatDialogActions,
} from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';

export interface PluginNodeConsentDialogData {
  manifest: PluginManifest;
  rememberChoice?: boolean;
}

@Component({
  selector: 'plugin-node-consent-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    MatCheckbox,
    FormsModule,
    TranslatePipe,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="info-icon">info</mat-icon>
      {{ T.PLUGINS.SYSTEM_ACCESS_REQUEST_TITLE | translate }}
    </h2>

    <mat-dialog-content>
      <div class="content">
        <p class="plugin-info">
          <strong>{{ data.manifest.name }}</strong> (v{{ data.manifest.version }})
        </p>

        <p>
          {{ T.PLUGINS.SYSTEM_ACCESS_REQUEST_DESC | translate }}
        </p>

        <ul class="capabilities">
          <li>{{ T.PLUGINS.CAPABILITIES.ACCESS_FILES | translate }}</li>
          <li>{{ T.PLUGINS.CAPABILITIES.RUN_COMMANDS | translate }}</li>
          <li>{{ T.PLUGINS.CAPABILITIES.USE_NODE_APIS | translate }}</li>
        </ul>

        <p class="trust-note">
          <mat-icon>verified_user</mat-icon>
          {{ T.PLUGINS.TRUST_WARNING | translate }}
        </p>

        <mat-checkbox
          [ngModel]="rememberChoice()"
          (ngModelChange)="rememberChoice.set($event)"
          class="remember-checkbox"
        >
          {{ T.PLUGINS.REMEMBER_CHOICE | translate }}
        </mat-checkbox>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button
        mat-button
        (click)="onCancel()"
      >
        {{ T.PLUGINS.CANCEL | translate }}
      </button>
      <button
        mat-raised-button
        (click)="onConfirm()"
        color="primary"
      >
        <mat-icon>check</mat-icon>
        {{ T.PLUGINS.GRANT_PERMISSION | translate }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      ul li {
        font-weight: bold;
      }

      mat-dialog-content {
        min-width: 400px;
        max-width: 500px;
      }

      .info-icon {
        color: #1976d2;
        vertical-align: middle;
        margin-right: 8px;
      }

      .content {
        padding: 8px 0;
      }

      .plugin-info {
        background: rgba(0, 0, 0, 0.05);
        padding: 12px;
        border-radius: 4px;
        margin-bottom: 16px;
      }

      .capabilities {
        margin: 16px 0;
        padding-left: 24px;
      }

      .capabilities li {
        margin: 4px 0;
      }

      .trust-note {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--extra-border-color);
        padding: 12px;
        border-radius: 4px;
        margin: 16px 0;
      }

      .trust-note mat-icon {
        color: #1976d2;
      }

      .remember-checkbox {
        margin-top: 16px;
      }

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    `,
  ],
})
export class PluginNodeConsentDialogComponent {
  private dialogRef = inject(MatDialogRef<PluginNodeConsentDialogComponent>);
  data = inject<PluginNodeConsentDialogData>(MAT_DIALOG_DATA);
  private _translateService = inject(TranslateService);

  T = T;
  rememberChoice = signal(this.data.rememberChoice ?? false);

  onConfirm(): void {
    this.dialogRef.close({ granted: true, remember: this.rememberChoice() });
  }

  onCancel(): void {
    this.dialogRef.close({ granted: false, remember: false });
  }
}
