import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FieldType } from '@ngx-formly/material';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { MatInput } from '@angular/material/input';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { DialogUnsplashPickerComponent } from '../dialog-unsplash-picker/dialog-unsplash-picker.component';
import { UnsplashService } from '../../core/unsplash/unsplash.service';

@Component({
  selector: 'formly-image-input',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, FormlyModule, MatInput, MatButton, MatIcon],
  templateUrl: './formly-image-input.component.html',
  styleUrls: ['./formly-image-input.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlyImageInputComponent extends FieldType<FormlyFieldConfig> {
  private _dialog = inject(MatDialog);
  private _unsplashService = inject(UnsplashService);

  get isUnsplashAvailable(): boolean {
    return this._unsplashService.isAvailable();
  }

  openFileExplorer(): void {
    const fileInput = document.createElement('input');

    fileInput.type = 'file';
    fileInput.accept = 'image/*';

    fileInput.addEventListener('change', (event: Event) => {
      const target = event.target as HTMLInputElement;

      if (target.files?.length) {
        const file = target.files[0];

        const reader = new FileReader();

        reader.onload = () => {
          const result = reader.result as string;

          this.formControl.setValue(result);
          this.formControl.markAsDirty();
          this.formControl.markAsTouched();

          document.body.removeChild(fileInput);
        };

        reader.readAsDataURL(file);
      }
    });

    document.body.appendChild(fileInput);
    fileInput.click();
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
