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
import { MatDialog } from '@angular/material/dialog';
import { GlobalThemeService } from '../global-theme.service';
import { DialogWallpaperComponent } from '../dialog-wallpaper/dialog-wallpaper.component';
import {
  CustomTheme,
  CustomThemeRef,
  CustomThemeService,
  getRequiredThemeMode,
} from '../custom-theme.service';
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
      <h3 class="appearance-title">{{ T.GCF.MISC.APPEARANCE | translate }}</h3>

      <div class="dark-mode-select">
        <span class="setting-label">{{ T.GCF.MISC.DARK_MODE | translate }}</span>
        <mat-button-toggle-group
          class="dark-mode-toggle"
          name="darkMode"
          [attr.aria-label]="T.GCF.MISC.DARK_MODE_ARIA_LABEL | translate"
          [value]="globalThemeService.darkMode()"
          [disabled]="activeRequiredMode() !== undefined"
          [hideSingleSelectionIndicator]="true"
          (change)="updateDarkMode($event)"
        >
          <mat-button-toggle value="system">
            <span class="dark-mode-toggle__content">
              <mat-icon>computer</mat-icon>
              <span class="dark-mode-toggle__label">
                {{ T.GCF.MISC.DARK_MODE_SYSTEM | translate }}
              </span>
            </span>
          </mat-button-toggle>
          <mat-button-toggle value="dark">
            <span class="dark-mode-toggle__content">
              <mat-icon>dark_mode</mat-icon>
              <span class="dark-mode-toggle__label">
                {{ T.GCF.MISC.DARK_MODE_DARK | translate }}
              </span>
            </span>
          </mat-button-toggle>
          <mat-button-toggle value="light">
            <span class="dark-mode-toggle__content">
              <mat-icon>light_mode</mat-icon>
              <span class="dark-mode-toggle__label">
                {{ T.GCF.MISC.DARK_MODE_LIGHT | translate }}
              </span>
            </span>
          </mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      <div class="theme-select">
        <span class="setting-label">{{ T.GCF.MISC.THEME_EXPERIMENTAL | translate }}</span>
        <div class="theme-select__controls">
          <mat-form-field
            appearance="outline"
            subscriptSizing="dynamic"
          >
            <mat-label>{{ T.GCF.MISC.THEME_SELECT_LABEL | translate }}</mat-label>
            <mat-select
              [value]="activeValue()"
              (selectionChange)="updateCustomTheme($event)"
            >
              @for (theme of customThemeService.themes(); track optionValue(theme)) {
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
            class="install-theme-btn"
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

      <div class="wallpaper-select">
        <span class="setting-label">{{ T.GCF.MISC.WALLPAPER | translate }}</span>
        <button
          class="wallpaper-btn"
          mat-stroked-button
          type="button"
          (click)="openWallpaperDialog()"
        >
          <mat-icon>wallpaper</mat-icon>
          {{ T.GCF.MISC.WALLPAPER_BUTTON | translate }}
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .theme-selector-container {
        display: flex;
        flex-direction: column;
        gap: var(--s2);
        padding: var(--s2);
        container-type: inline-size;
      }

      .dark-mode-select,
      .theme-select,
      .wallpaper-select {
        display: grid;
        grid-template-columns: minmax(120px, 1fr) minmax(0, 3fr);
        align-items: center;
        gap: var(--s2);
      }

      .appearance-title {
        margin: 0;
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
      }

      .setting-label {
        font-size: var(--font-size-md);
      }

      mat-form-field {
        width: 100%;
        margin-bottom: 0;
        --mat-form-field-container-height: var(--bar-height-small);
        --mat-form-field-container-vertical-padding: var(--s);
        --mat-form-field-outlined-container-shape: var(--input-border-radius);
      }

      .theme-select__controls {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--s);
        width: 100%;
      }

      .install-theme-btn {
        --mat-button-outlined-container-height: var(--bar-height-small);
      }

      .dark-mode-toggle {
        display: flex;
        align-items: stretch;
        width: 100%;
        --mat-button-toggle-height: var(--bar-height-small);
        --mat-button-toggle-label-text-size: var(--font-size-md);
        --mat-button-toggle-shape: var(--input-border-radius);

        /*
         * Selection reads the same way the settings tab strip marks its active
         * tab: the --state-selected fill plus the theme's primary on the icon.
         * Unselected options sit transparent on the card so the tint actually
         * shows — against Material's own group fill (#424242 dark, white light)
         * the same 10% overlay is barely a shade apart.
         *
         * Both values come from the design system rather than Material's
         * defaults for these tokens, which are hardcoded black/white alphas
         * and so ignore the active theme. --state-selected is built from
         * --ink-on-channel and --c-primary from the palette, so the control
         * tracks every theme, custom ones included.
         */
        --mat-button-toggle-background-color: transparent;
        --mat-button-toggle-selected-state-background-color: var(--state-selected);
        --mat-button-toggle-selected-state-text-color: var(--text-color);

        /*
         * The disabled variants are a separate, more specific rule in Material,
         * so they need the same treatment or the group flips to an opaque grey
         * block whenever the active theme forces a mode.
         */
        --mat-button-toggle-disabled-state-background-color: transparent;
        --mat-button-toggle-disabled-selected-state-background-color: var(
          --state-selected
        );
      }

      .dark-mode-toggle mat-button-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1 1 0;
        min-width: 0;
      }

      .dark-mode-toggle mat-icon {
        margin-inline-end: var(--s-half);
        font-size: 20px;
        width: 20px;
        height: 20px;
        vertical-align: middle;
      }

      .dark-mode-toggle__content {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        max-width: 100%;
        height: var(--bar-height-small);
        vertical-align: top;
      }

      /*
       * Only the icon takes the accent, not the label. The tab strip this
       * mirrors is icon-only at the widths where it is the reference, so
       * tinting its label was never part of the pattern — and the palette blue
       * lands at 2.4:1 on the light card, well under the 4.5:1 a word like
       * "Dark" needs to stay readable. The label keeps --text-color (11.2:1)
       * and the icon reads as an accent on top of the fill, which is what
       * actually carries the selection.
       */
      .dark-mode-toggle .mat-button-toggle-checked mat-icon {
        color: var(--c-primary);
      }

      .dark-mode-toggle__label {
        overflow: hidden;
        text-overflow: ellipsis;
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
        opacity: var(--muted-alpha);
        margin-inline-start: var(--s-half);
      }

      .remove-theme-btn {
        margin-inline-start: var(--s);
        flex: 0 0 auto;
      }

      /*
       * The query measures this container's content box, not the viewport —
       * roughly viewport minus sidebar minus the card and container padding.
       * Measured floor is 388px: below that the label column sits at its 120px
       * minimum and the toggle group can no longer fit three labelled options.
       * Stack just above it, and give the controls the full width.
       */
      @container (max-width: 400px) {
        .dark-mode-select,
        .theme-select,
        .wallpaper-select {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: var(--s);
        }

        .theme-select__controls {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          width: 100%;
        }

        .wallpaper-btn {
          width: 100%;
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
  private readonly _matDialog = inject(MatDialog);
  readonly T = T;

  readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly activeValue = computed(() => refToValue(this.customThemeService.activeRef()));

  readonly activeRequiredMode = computed(() =>
    getRequiredThemeMode(this.customThemeService.activeRef()),
  );

  optionValue(theme: CustomTheme): string {
    return refToValue({ kind: theme.kind, id: theme.id });
  }

  updateDarkMode(ev: MatButtonToggleChange): void {
    if (!this.activeRequiredMode() && ev.value) {
      this.globalThemeService.darkMode.set(ev.value);
    }
  }

  async updateCustomTheme(ev: MatSelectChange): Promise<void> {
    const ref = valueToRef(ev.value);
    const wasActivated = await this.customThemeService.setActiveTheme(ref);
    if (!wasActivated) return;

    if (ref.kind === 'builtin') {
      const theme = this.customThemeService
        .themes()
        .find((t) => t.kind === 'builtin' && t.id === ref.id);
      if (theme?.requiredMode && theme.requiredMode !== 'system') {
        this.globalThemeService.darkMode.set(theme.requiredMode);
      }
    }
  }

  openFilePicker(): void {
    this.fileInput()?.nativeElement.click();
  }

  openWallpaperDialog(): void {
    this._matDialog.open(DialogWallpaperComponent, { autoFocus: false });
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
