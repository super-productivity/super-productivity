import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { UserProfileService } from '../user-profile.service';
import { UserProfile } from '../user-profile.model';
import { SnackService } from '../../../core/snack/snack.service';
import { TranslatePipe } from '@ngx-translate/core';
import { IS_ELECTRON } from '../../../app.constants';
import { T } from '../../../t.const';
import { confirmDialog } from '../../../util/native-dialogs';

@Component({
  selector: 'dialog-user-profile-management',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIconButton,
    MatIcon,
    MatTooltip,
    MatFormField,
    MatLabel,
    MatInput,
    FormsModule,
    TranslatePipe,
  ],
  templateUrl: './dialog-user-profile-management.component.html',
  styleUrls: ['./dialog-user-profile-management.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogUserProfileManagementComponent {
  readonly profileService = inject(UserProfileService);
  private readonly _snackService = inject(SnackService);
  private readonly _matDialogRef = inject(MatDialogRef);

  readonly newProfileName = signal('');
  readonly editingProfileId = signal<string | null>(null);
  readonly editingProfileName = signal('');
  readonly isCreating = signal(false);

  readonly isElectron = IS_ELECTRON;
  readonly T = T;

  async createProfile(): Promise<void> {
    const name = this.newProfileName();

    this.isCreating.set(true);
    try {
      await this.profileService.createProfile(name);
      this.newProfileName.set('');
    } catch (error: any) {
      this._snackService.open({ type: 'ERROR', msg: error.message });
    } finally {
      this.isCreating.set(false);
    }
  }

  startEdit(profile: UserProfile): void {
    this.editingProfileId.set(profile.id);
    this.editingProfileName.set(profile.name);
  }

  cancelEdit(): void {
    this.editingProfileId.set(null);
    this.editingProfileName.set('');
  }

  async saveEdit(profileId: string): Promise<void> {
    const newName = this.editingProfileName();

    try {
      await this.profileService.renameProfile(profileId, newName);
      this.cancelEdit();
    } catch (error: any) {
      this._snackService.open({ type: 'ERROR', msg: error.message });
    }
  }

  async deleteProfile(profile: UserProfile): Promise<void> {
    if (
      !confirmDialog(`Are you sure you want to delete the profile "${profile.name}"?`)
    ) {
      return;
    }

    try {
      await this.profileService.deleteProfile(profile.id);
    } catch (error: any) {
      this._snackService.open({ type: 'ERROR', msg: error.message });
    }
  }

  async exportProfile(profile: UserProfile): Promise<void> {
    try {
      await this.profileService.exportProfile(profile.id);
    } catch (error: any) {
      this._snackService.open({
        type: 'ERROR',
        msg: `Failed to export profile: ${error.message}`,
      });
    }
  }

  close(): void {
    this._matDialogRef.close();
  }
}
