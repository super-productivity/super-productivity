import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  inject,
  signal,
} from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog'; // Import MatDialogModule
import { T } from '../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { Log } from '../../core/log';

@Component({
  selector: 'dialog-import-from-url',
  templateUrl: './dialog-import-from-url.component.html',
  styleUrls: ['./dialog-import-from-url.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatDialogModule, // Ensure MatDialogModule is imported here for standalone
    // CommonModule will be automatically available for standalone components for ngIf, ngFor, etc.
    TranslatePipe, // If you use it in the template, import it
  ],
})
export class DialogImportFromUrlComponent {
  @Output() urlEntered = new EventEmitter<string>();

  url = signal('');
  T = T;

  private _dialogRef = inject(MatDialogRef<DialogImportFromUrlComponent>);

  constructor() {}

  submit(): void {
    const urlVal = (this.url() || '').trim();
    if (urlVal !== '') {
      this.urlEntered.emit(urlVal);
      this._dialogRef.close(urlVal);
    } else {
      Log.err('URL is required.');
    }
  }

  cancel(): void {
    this._dialogRef.close();
  }
}
