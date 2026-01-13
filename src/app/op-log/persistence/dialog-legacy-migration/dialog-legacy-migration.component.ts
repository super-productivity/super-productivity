import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
  MatDialogActions,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { T } from '../../../t.const';

export type MigrationStatus = 'preparing' | 'backup' | 'migrating' | 'complete' | 'error';

@Component({
  selector: 'dialog-legacy-migration',
  templateUrl: './dialog-legacy-migration.component.html',
  styleUrls: ['./dialog-legacy-migration.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    TranslateModule,
    MatIcon,
    MatProgressSpinner,
  ],
})
export class DialogLegacyMigrationComponent {
  private _dialogRef = inject(MatDialogRef<DialogLegacyMigrationComponent>);

  T = T;

  status = signal<MigrationStatus>('preparing');
  error = signal<string | null>(null);

  getStatusKey(): string {
    const statusMap: Record<MigrationStatus, string> = {
      preparing: T.MIGRATE.STATUS_PREPARING,
      backup: T.MIGRATE.STATUS_BACKUP,
      migrating: T.MIGRATE.STATUS_MIGRATING,
      complete: T.MIGRATE.STATUS_COMPLETE,
      error: '', // Error uses the error signal directly
    };
    return statusMap[this.status()];
  }

  hasError(): boolean {
    return this.error() !== null;
  }

  acknowledge(): void {
    this._dialogRef.close();
  }
}
