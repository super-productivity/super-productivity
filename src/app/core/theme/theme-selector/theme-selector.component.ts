import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import {
  MatButtonToggle,
  MatButtonToggleChange,
  MatButtonToggleGroup,
} from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton, MatButton } from '@angular/material/button';
import { MatSelect, MatSelectChange } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatTooltip } from '@angular/material/tooltip';
import { GlobalThemeService } from '../global-theme.service';
import { CustomTheme, CustomThemeRef, CustomThemeService } from '../custom-theme.service';
import { ThemeStorageService } from '../theme-storage.service';
import { SnackService } from '../../snack/snack.service';
import { T } from '../../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { Log } from '../../log';

const refToValue = (ref: CustomThemeRef): string => `${ref.kind}:${ref.id}`;

const valueToRef = (value: string): CustomThemeRef => {
  const idx = value.indexOf(':');
  if (idx <= 0) return { kind: 'builtin', id: 'default' };
  const kind = value.slice(0, idx);
  const id = value.slice(idx + 1);
  if (kind === 'user') return { kind: 'user', id };
  return { kind: 'builtin', id };
};

@Component({
  selector: 'theme-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonToggleGroup,
    MatButtonToggle,
    MatIcon,
    MatIconButton,
    MatButton,
    MatSelect,
    MatOption,
    MatFormField,
    MatLabel,
    MatTooltip,
    TranslatePipe,
  ],
  template: `
    <div class="theme-selector-container">
      <div class="dark-mode-select">
        <h3>{{ T.GCF.MISC.DARK_MODE | translate }}</h3>
        <mat-button-toggle-group
          name="darkMode"
          [attr.aria-label]="T.GCF.MISC.DARK_MODE_ARIA_LABEL | translate"
          [value]="globalThemeService.darkMode()"
          (change)="updateDarkMode($event)"
        >
          <mat-button-toggle value="system">
            <mat-icon>computer</mat-icon>
            {{ T.GCF.MISC.DARK_MODE_SYSTEM | translate }}
          </mat-button-toggle>
          <mat-button-toggle value="dark">
            <mat-icon>dark_mode</mat-icon>
            {{ T.GCF.MISC.DARK_MODE_DARK | translate }}
          </mat-button-toggle>
          <mat-button-toggle value="light">
            <mat-icon>light_mode</mat-icon>
            {{ T.GCF.MISC.DARK_MODE_LIGHT | translate }}
          </mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      <div class="theme-select">
        <h3>{{ T.GCF.MISC.THEME_EXPERIMENTAL | translate }}</h3>
        <mat-form-field appearance="outline">
          <mat-label>{{ T.GCF.MISC.THEME_SELECT_LABEL | translate }}</mat-label>
          <mat-select
            [value]="activeValue()"
            (selectionChange)="updateCustomTheme($event)"
          >
            @for (theme of customThemeService.themes(); track theme.id) {
              <mat-option [value]="optionValue(theme)">
                <span class="theme-option-row">
                  <span class="theme-option-label">{{ theme.name }}</span>
                  @if (theme.requiredMode && theme.requiredMode !== 'system') {
                    <span class="theme-mode-indicator">
                      ({{ theme.requiredMode === 'dark' ? '🌙' : '☀️' }})
                    </span>
                  }
                  @if (theme.kind === 'user') {
                    <button
                      mat-icon-button
                      type="button"
                      class="remove-theme-btn"
                      [attr.aria-label]="T.GCF.MISC.THEME_REMOVE_BUTTON | translate"
                      (click)="removeUserTheme($event, theme.id)"
                    >
                      <mat-icon color="warn">delete</mat-icon>
                    </button>
                  }
                </span>
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
        <button
          mat-stroked-button
          type="button"
          [matTooltip]="T.GCF.MISC.THEME_INSTALL_TOOLTIP | translate"
          matTooltipPosition="above"
          (click)="openFilePicker()"
        >
          <mat-icon>upload</mat-icon>
          {{ T.GCF.MISC.THEME_INSTALL_BUTTON | translate }}
        </button>
        <input
          #fileInput
          type="file"
          accept=".css,text/css"
          hidden
          (change)="onFileSelected($event)"
        />
      </div>
    </div>
  `,
  styles: [
    `
      .theme-selector-container {
        display: flex;
        flex-direction: column;
        gap: 24px;
        margin: 20px 0;
      }

      .dark-mode-select,
      .theme-select {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      h3 {
        margin: 0;
        min-width: 100px;
      }

      mat-form-field {
        flex: 1;
        max-width: 300px;
      }

      .theme-option-row {
        display: flex;
        align-items: center;
        width: 100%;
      }

      .theme-option-label {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .theme-mode-indicator {
        opacity: 0.7;
        margin-left: 4px;
      }

      .remove-theme-btn {
        margin-left: 8px;
        flex: 0 0 auto;
      }

      @media (max-width: 600px) {
        .dark-mode-select,
        .theme-select {
          flex-direction: column;
          align-items: flex-start;
        }

        mat-form-field {
          width: 100%;
          max-width: none;
        }
      }
    `,
  ],
})
export class ThemeSelectorComponent {
  readonly globalThemeService = inject(GlobalThemeService);
  readonly customThemeService = inject(CustomThemeService);
  private readonly _themeStorage = inject(ThemeStorageService);
  private readonly _snackService = inject(SnackService);
  readonly T = T;

  readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly activeValue = computed(() => refToValue(this.customThemeService.activeRef()));

  optionValue(theme: CustomTheme): string {
    return refToValue({ kind: theme.kind, id: theme.id });
  }

  updateDarkMode(ev: MatButtonToggleChange): void {
    if (ev.value) {
      this.globalThemeService.darkMode.set(ev.value);
    }
  }

  async updateCustomTheme(ev: MatSelectChange): Promise<void> {
    const ref = valueToRef(ev.value);
    await this.customThemeService.setActiveTheme(ref);

    if (ref.kind === 'builtin') {
      const theme = this.customThemeService
        .themes()
        .find((t) => t.kind === 'builtin' && t.id === ref.id);
      if (theme?.requiredMode) {
        this.globalThemeService.darkMode.set(theme.requiredMode);
      }
    }
  }

  openFilePicker(): void {
    this.fileInput()?.nativeElement.click();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      const stored = await this._themeStorage.installFromFile(file);
      await this.customThemeService.setActiveTheme({ kind: 'user', id: stored.id });
      // Surface contract warnings (presence-only) as a non-blocking snackbar.
      // SnackService translates `msg` and interpolates `translateParams` —
      // no need to inject TranslateService here.
      const warnings = stored.warnings ?? [];
      if (warnings.length > 0) {
        const head = warnings.slice(0, 5).map((w) => w.token);
        const more = warnings.length > 5 ? ` (+${warnings.length - 5} more)` : '';
        this._snackService.open({
          type: 'CUSTOM',
          msg: T.GCF.MISC.THEME_INSTALLED_WITH_WARNINGS,
          translateParams: { tokens: head.join(', ') + more },
        });
      }
    } catch {
      // Log a coarse signal — the error message originates from validator
      // output that may echo user-controlled CSS bytes, and the filename can
      // be PII. Both are excluded from the (exportable) Log payload.
      Log.err({ stage: 'install-from-file', reason: 'install-failed' });
      this._snackService.open({
        msg: T.GCF.MISC.THEME_INVALID_CSS_FILE,
        type: 'ERROR',
      });
    }
  }

  async removeUserTheme(event: Event, id: string): Promise<void> {
    event.stopPropagation();
    try {
      const wasActive = await this.customThemeService.removeUserTheme(id);
      if (wasActive) {
        this._snackService.open({ msg: T.GCF.MISC.THEME_REMOVED_TOAST });
      }
    } catch (err) {
      Log.err({ themeId: id, reason: 'remove-failed' });
      this._snackService.open({
        msg: T.GCF.MISC.THEME_INVALID_CSS_FILE,
        type: 'ERROR',
      });
    }
  }
}
