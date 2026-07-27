import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { UserProfile } from '../user-profile.model';

export interface DisableProfilesDialogData {
  activeProfile: UserProfile;
  otherProfiles: UserProfile[];
}

@Component({
  selector: 'dialog-disable-profiles-confirmation',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>warning</mat-icon>
      Disable User Profiles?
    </h2>

    <mat-dialog-content>
      <p>
        <strong>Warning:</strong> You have {{ data.otherProfiles.length + 1 }} profiles
        configured.
      </p>

      <div class="info-section">
        <h3>What will happen:</h3>
        <ul>
          <li>The profile management UI will be hidden</li>
          <li>
            Your current profile <strong>"{{ data.activeProfile.name }}"</strong> will
            remain active
          </li>
          <li>You will continue working with the current profile's data</li>
          <li>Other profiles will be preserved but inaccessible</li>
        </ul>
      </div>

      @if (data.otherProfiles.length > 0) {
        <div class="profiles-info">
          <h3>Inactive profiles that will be hidden:</h3>
          <ul>
            @for (profile of data.otherProfiles; track profile.id) {
              <li>{{ profile.name }}</li>
            }
          </ul>
        </div>
      }

      <div class="recovery-info">
        <h3>How to recover inactive profile data:</h3>
        <ol>
          <li>
            <strong>Re-enable profiles:</strong> Simply re-enable "User Profiles" in
            settings and switch to the desired profile
          </li>
          <li>
            <strong>Or export/import:</strong> Profile backups are stored in the
            application data folder under <code>profiles/</code>
          </li>
          <li>
            You can use Settings → Import/Export to import profile data from these backup
            files
          </li>
        </ol>
      </div>

      <p class="note callout callout--info">
        <mat-icon aria-hidden="true">info</mat-icon>
        <strong>Note:</strong> No data will be deleted. You can re-enable this feature at
        any time.
      </p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button
        mat-button
        (click)="dialogRef.close(false)"
      >
        Cancel
      </button>
      <button
        mat-raised-button
        color="warn"
        (click)="dialogRef.close(true)"
      >
        Disable Profiles
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      h2 {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--color-warning);
      }

      .info-section,
      .profiles-info,
      .recovery-info {
        margin: 16px 0;
        padding: 12px;
        background: rgba(0, 0, 0, 0.05);
        border-radius: 4px;
      }

      h3 {
        margin: 0 0 8px 0;
        font-size: 14px;
        font-weight: 600;
      }

      ul,
      ol {
        margin: 8px 0;
        padding-left: 20px;
      }

      li {
        margin: 4px 0;
      }

      code {
        background: rgba(0, 0, 0, 0.1);
        padding: 2px 6px;
        border-radius: 3px;
        font-family: 'Courier New', monospace;
        font-size: 13px;
      }

      /* Box styling comes from the global .callout (src/styles/components/_callout.scss);
         per convention the consumer only sets outer margin. */
      .note {
        margin-top: var(--s2);
      }

      mat-dialog-actions {
        margin-top: 16px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogDisableProfilesConfirmationComponent {
  readonly dialogRef = inject(MatDialogRef<DialogDisableProfilesConfirmationComponent>);
  readonly data = inject<DisableProfilesDialogData>(MAT_DIALOG_DATA);
}
