import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { FieldType } from '@ngx-formly/material';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { MatInput } from '@angular/material/input';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { DialogUnsplashPickerComponent } from '../dialog-unsplash-picker/dialog-unsplash-picker.component';
import { UnsplashService } from '../../core/unsplash/unsplash.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { IS_ELECTRON } from '../../app.constants';

const MAX_BACKGROUND_IMAGE_FILE_SIZE_BYTES = 200 * 1024;

@Component({
  selector: 'formly-image-input',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    FormlyModule,
    MatInput,
    MatButton,
    MatIcon,
    TranslatePipe,
  ],
  templateUrl: './formly-image-input.component.html',
  styleUrls: ['./formly-image-input.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlyImageInputComponent extends FieldType<FormlyFieldConfig> {
  private _dialog = inject(MatDialog);
  private _unsplashService = inject(UnsplashService);
  private _snackService = inject(SnackService);
  readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  readonly T = T;
  readonly IS_ELECTRON = IS_ELECTRON;

  get isUnsplashAvailable(): boolean {
    return this._unsplashService.isAvailable();
  }

  async openFileExplorer(): Promise<void> {
    if (!IS_ELECTRON) {
      return;
    }

    const selectedPaths = await window.ea.showOpenDialog({
      properties: ['openFile'],
      title: 'Select image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    const selectedPath = selectedPaths?.[0];
    if (selectedPath) {
      const normalizedPath = selectedPath.replace(/\\/g, '/');
      this.formControl.setValue(`file://${normalizedPath}`);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) {
      return;
    }

    if (file.size > MAX_BACKGROUND_IMAGE_FILE_SIZE_BYTES) {
      this._snackService.open({
        msg: T.F.PROJECT.FORM_THEME.S_BACKGROUND_IMAGE_TOO_LARGE,
        type: 'ERROR',
        translateParams: {
          maxSizeKb: Math.round(MAX_BACKGROUND_IMAGE_FILE_SIZE_BYTES / 1024),
        },
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      this.formControl.setValue(result);
    };
    reader.onerror = () => {
      this._snackService.open({
        msg: T.F.PROJECT.FORM_THEME.S_BACKGROUND_IMAGE_READ_ERROR,
        type: 'ERROR',
      });
    };
    reader.readAsDataURL(file);
  }

  openUnsplashPicker(): void {
    if (!this.isUnsplashAvailable) {
      console.warn('Unsplash service is not available - no API key configured');
      return;
    }

    const dialogRef = this._dialog.open(DialogUnsplashPickerComponent, {
      width: '900px',
      maxWidth: '95vw',
    });

    dialogRef.afterClosed().subscribe((result: string | { url: string } | null) => {
      if (result) {
        // Handle both string (legacy) and object (new) return formats
        const url = typeof result === 'string' ? result : result.url;
        if (url) {
          this.formControl.setValue(url);
          // TODO: Store attribution data if needed for compliance display
        }
      }
    });
  }
}
