import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { UserProfileService } from '../user-profile.service';
import { DialogUserProfileManagementComponent } from '../dialog-user-profile-management/dialog-user-profile-management.component';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatDivider } from '@angular/material/divider';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';

@Component({
  selector: 'user-profile-button',
  standalone: true,
  imports: [
    CommonModule,
    MatIconButton,
    MatIcon,
    MatTooltip,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatDivider,
    TranslatePipe,
  ],
  template: `
    <button
      mat-icon-button
      [matTooltip]="
        'User Profile: ' + (profileService.activeProfile()?.name || 'Loading...')
      "
      [matMenuTriggerFor]="profileMenu"
      class="profile-btn"
    >
      <mat-icon>account_circle</mat-icon>
    </button>

    <mat-menu #profileMenu="matMenu">
      @if (profileService.activeProfile(); as activeProfile) {
        <div class="profile-menu-header">
          <strong>{{ activeProfile.name }}</strong>
        </div>
      }
      @for (profile of profileService.profiles(); track profile.id) {
        <button
          mat-menu-item
          [disabled]="profile.id === profileService.activeProfile()?.id"
          (click)="switchToProfile(profile.id)"
        >
          <mat-icon>
            {{ profile.id === profileService.activeProfile()?.id ? 'check' : 'person' }}
          </mat-icon>
          <span>{{ profile.name }}</span>
        </button>
      }
      <mat-divider></mat-divider>
      <button
        mat-menu-item
        (click)="openManagementDialog()"
      >
        <mat-icon>settings</mat-icon>
        <span>{{ T.USER_PROFILES.MANAGE_PROFILES | translate }}</span>
      </button>
    </mat-menu>
  `,
  styles: [
    `
      .profile-btn {
        margin-left: 8px;
      }

      .profile-menu-header {
        padding: 8px 16px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.12);
        margin-bottom: 4px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserProfileButtonComponent {
  readonly profileService = inject(UserProfileService);
  private readonly _matDialog = inject(MatDialog);

  readonly isLoading = signal(false);
  readonly T = T;

  async switchToProfile(profileId: string): Promise<void> {
    if (this.isLoading()) return;

    this.isLoading.set(true);
    try {
      await this.profileService.switchProfile(profileId);
    } catch (error) {
      console.error('Failed to switch profile:', error);
      this.isLoading.set(false);
    }
  }

  openManagementDialog(): void {
    this._matDialog.open(DialogUserProfileManagementComponent, {
      width: '600px',
      maxHeight: '80vh',
    });
  }
}
