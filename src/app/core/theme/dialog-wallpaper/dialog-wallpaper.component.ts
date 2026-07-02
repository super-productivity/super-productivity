import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { ReactiveFormsModule, UntypedFormGroup } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { MiscConfig } from '../../../features/config/global-config.model';
import {
  DEFAULT_BACKGROUND_OVERLAY_OPACITY,
  hasAnyBackgroundImage,
  MAX_BACKGROUND_IMAGE_BLUR,
} from '../../../features/work-context/work-context.const';
import { GlobalWallpaperCfg } from '../global-theme.service';

// Mutable copy of the global wallpaper shape so Formly can write to the model.
type WallpaperModel = {
  -readonly [K in keyof GlobalWallpaperCfg]: GlobalWallpaperCfg[K];
};

// Mirrors the image-input + slider controls of the per-context theme form
// (work-context.const.ts); built fresh per dialog open because Formly mutates
// field configs at runtime. Opacity/blur stay hidden until an image is set.
const buildWallpaperFields = (): FormlyFieldConfig[] => [
  {
    key: 'backgroundImageDark',
    type: 'image-input',
    templateOptions: {
      label: T.F.PROJECT.FORM_THEME.L_BACKGROUND_IMAGE_DARK,
      description: '* https://some/cool.jpg',
    },
  },
  {
    key: 'backgroundImageLight',
    type: 'image-input',
    templateOptions: {
      label: T.F.PROJECT.FORM_THEME.L_BACKGROUND_IMAGE_LIGHT,
      description: '* https://some/cool.jpg',
    },
  },
  {
    key: 'backgroundOverlayOpacity',
    type: 'slider',
    resetOnHide: false,
    props: {
      label: T.F.PROJECT.FORM_THEME.L_BACKGROUND_OVERLAY_OPACITY,
      description: T.F.PROJECT.FORM_THEME.D_BACKGROUND_OVERLAY_OPACITY,
      type: 'number',
      min: 0,
      max: 99,
      required: false,
      displayWith: (value: number): string => `${value}%`,
    },
    expressions: {
      hide: (field: FormlyFieldConfig): boolean => !hasAnyBackgroundImage(field.model),
    },
  },
  {
    key: 'backgroundImageBlur',
    type: 'slider',
    resetOnHide: false,
    props: {
      label: T.F.PROJECT.FORM_THEME.L_BACKGROUND_IMAGE_BLUR,
      description: T.F.PROJECT.FORM_THEME.D_BACKGROUND_IMAGE_BLUR,
      type: 'number',
      min: 0,
      max: MAX_BACKGROUND_IMAGE_BLUR,
      required: false,
      displayWith: (value: number): string => `${value}px`,
    },
    expressions: {
      hide: (field: FormlyFieldConfig): boolean => !hasAnyBackgroundImage(field.model),
    },
  },
];

@Component({
  selector: 'dialog-wallpaper',
  standalone: true,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    ReactiveFormsModule,
    FormlyModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 mat-dialog-title>{{ T.GCF.MISC.WALLPAPER_DIALOG_TITLE | translate }}</h1>
    <mat-dialog-content>
      <p class="wallpaper-hint">{{ T.GCF.MISC.WALLPAPER_HINT | translate }}</p>
      <form [formGroup]="form">
        <formly-form
          [form]="form"
          [fields]="fields"
          [model]="model"
          (modelChange)="model = $event"
        ></formly-form>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-button
        type="button"
        (click)="close()"
      >
        {{ T.G.CANCEL | translate }}
      </button>
      <button
        mat-flat-button
        color="primary"
        type="button"
        (click)="save()"
      >
        {{ T.G.SAVE | translate }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .wallpaper-hint {
        margin: 0 0 16px;
        opacity: 0.7;
      }
    `,
  ],
})
export class DialogWallpaperComponent {
  private _dialogRef = inject<MatDialogRef<DialogWallpaperComponent>>(MatDialogRef);
  private _globalConfigService = inject(GlobalConfigService);

  readonly T = T;
  readonly form = new UntypedFormGroup({});
  readonly fields = buildWallpaperFields();

  model: WallpaperModel = ((): WallpaperModel => {
    const misc = this._globalConfigService.misc();
    return {
      backgroundImageDark: misc?.backgroundImageDark ?? null,
      backgroundImageLight: misc?.backgroundImageLight ?? null,
      backgroundOverlayOpacity:
        misc?.backgroundOverlayOpacity ?? DEFAULT_BACKGROUND_OVERLAY_OPACITY,
      backgroundImageBlur: misc?.backgroundImageBlur ?? 0,
    };
  })();

  save(): void {
    const changes: Partial<MiscConfig> = {
      // A cleared picker stores '' — normalize to null so the fallback chain
      // (context → global → none) treats it as unset.
      backgroundImageDark: this.model.backgroundImageDark || null,
      backgroundImageLight: this.model.backgroundImageLight || null,
      backgroundOverlayOpacity: this.model.backgroundOverlayOpacity,
      backgroundImageBlur: this.model.backgroundImageBlur,
    };
    this._globalConfigService.updateSection('misc', changes);
    this._dialogRef.close();
  }

  close(): void {
    this._dialogRef.close();
  }
}
