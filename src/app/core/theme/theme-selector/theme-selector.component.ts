import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MatButtonToggle,
  MatButtonToggleChange,
  MatButtonToggleGroup,
} from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { AsyncPipe } from '@angular/common';
import { GlobalThemeService } from '../global-theme.service';
import { CustomThemeService } from '../custom-theme.service';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { T } from '../../../t.const';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'theme-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonToggleGroup,
    MatButtonToggle,
    MatIcon,
    MatSelect,
    MatOption,
    MatFormField,
    MatLabel,
    AsyncPipe,
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
            [value]="(configService.misc$ | async)?.customTheme || 'default'"
            (selectionChange)="updateCustomTheme($event.value)"
          >
            @for (theme of customThemeService.getAvailableThemes(); track theme.id) {
              <mat-option [value]="theme.id">
                {{ theme.name }}
                @if (theme.requiredMode && theme.requiredMode !== 'system') {
                  <span class="theme-mode-indicator">
                    ({{ theme.requiredMode === 'dark' ? '🌙' : '☀️' }})
                  </span>
                }
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
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

      .theme-mode-indicator {
        opacity: 0.7;
        margin-left: 4px;
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
  readonly configService = inject(GlobalConfigService);
  readonly T = T;

  updateDarkMode(ev: MatButtonToggleChange): void {
    if (ev.value) {
      this.globalThemeService.darkMode.set(ev.value);
    }
  }

  updateCustomTheme(themeId: string): void {
    this.configService.updateSection('misc', { customTheme: themeId });

    // Auto-switch dark mode based on theme requirements
    const theme = this.customThemeService
      .getAvailableThemes()
      .find((t) => t.id === themeId);
    if (theme?.requiredMode) {
      this.globalThemeService.darkMode.set(theme.requiredMode);
    }
  }
}
