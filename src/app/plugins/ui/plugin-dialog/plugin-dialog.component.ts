import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DialogButtonCfg, DialogCfg } from '../../plugin-api.model';
import { PluginSecurityService } from '../../plugin-security';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { PluginLog } from '../../../core/log';

@Component({
  selector: 'plugin-dialog',
  template: `
    <div mat-dialog-title>
      {{ dialogData.title || _translateService.instant(T.PLUGINS.PLUGIN_DIALOG_TITLE) }}
    </div>

    <mat-dialog-content>
      @if (sanitizedContent) {
        <div [innerHTML]="sanitizedContent"></div>
      } @else {
        <div>
          {{
            dialogData.htmlContent ||
              _translateService.instant(T.PLUGINS.NO_CONTENT_PROVIDED)
          }}
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @for (button of dialogData.buttons || defaultButtons; track $index) {
        @if (button.raised) {
          <button
            mat-raised-button
            [color]="button.color || 'primary'"
            (click)="onButtonClick(button)"
          >
            @if (button.icon) {
              <mat-icon>{{ button.icon }}</mat-icon>
            }
            {{ button.label }}
          </button>
        } @else {
          <button
            mat-button
            [color]="button.color || 'primary'"
            (click)="onButtonClick(button)"
          >
            @if (button.icon) {
              <mat-icon>{{ button.icon }}</mat-icon>
            }
            {{ button.label }}
          </button>
        }
      }
    </mat-dialog-actions>
  `,
  styles: [
    `
      mat-dialog-content {
        min-width: 300px;
        max-width: 900px;
        width: 70vw;
        max-height: 70vh;
        overflow-y: auto;
      }

      @media (max-width: 599px) {
        mat-dialog-content {
          min-width: unset;
          width: auto;
        }
      }

      mat-dialog-actions {
        gap: 8px;
      }

      mat-icon {
        margin-right: 8px;
      }

      /* Default styles for native form elements injected by plugins */
      :host ::ng-deep select,
      :host ::ng-deep textarea,
      :host ::ng-deep input {
        background: var(--bg-lighter);
        color: var(--text-color);
        border: none;
        border-bottom: 1px solid var(--divider-color);
        border-radius: 4px 4px 0 0;
        padding: 8px;
        font-family: var(--font-primary-stack);
        font-size: 14px;
      }

      :host ::ng-deep select:focus,
      :host ::ng-deep textarea:focus,
      :host ::ng-deep input:focus {
        outline: none;
        border-bottom-color: var(--c-primary);
        border-bottom-width: 2px;
      }

      :host ::ng-deep input[type='checkbox'],
      :host ::ng-deep input[type='radio'] {
        accent-color: var(--c-primary);
      }

      :host ::ng-deep select option {
        background: var(--bg-lighter);
        color: var(--text-color);
      }

      :host ::ng-deep textarea {
        resize: vertical;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatIcon, MatDialogActions, MatDialogContent, MatDialogTitle],
})
export class PluginDialogComponent {
  private readonly _dialogRef = inject(MatDialogRef<PluginDialogComponent>);
  private readonly _sanitizer = inject(DomSanitizer);
  private readonly _pluginSecurity = inject(PluginSecurityService);
  readonly _translateService = inject(TranslateService);

  readonly dialogData: DialogCfg & { title?: string };
  readonly sanitizedContent: SafeHtml | null = null;
  readonly T = T;
  readonly defaultButtons: DialogButtonCfg[] = [
    {
      label: this._translateService.instant(T.PLUGINS.OK),
      onClick: () => this._dialogRef.close(),
    },
  ];

  data = inject<DialogCfg & { title?: string }>(MAT_DIALOG_DATA);

  constructor() {
    this.dialogData = this.data;

    // Sanitize HTML content if provided
    if (this.data.htmlContent) {
      this.sanitizedContent = this._sanitizer.bypassSecurityTrustHtml(
        this._pluginSecurity.sanitizeHtml(this.data.htmlContent),
      );
    }
  }

  async onButtonClick(button: DialogButtonCfg): Promise<void> {
    try {
      if (button.onClick) {
        await button.onClick();
      }
      // Close dialog after button action completes (unless button prevents it)
      if (!this._dialogRef.disableClose) {
        this._dialogRef.close(button.label);
      }
    } catch (error) {
      PluginLog.err('Plugin dialog button action failed:', error);
      this._dialogRef.close('error');
    }
  }
}
