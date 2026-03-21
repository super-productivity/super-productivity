import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

export type WelcomeDialogResult = 'addTask' | 'tour' | 'skip';

@Component({
  selector: 'welcome-dialog',
  standalone: true,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatButton, MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .feature-list {
      list-style: none;
      padding: 0;
      margin: var(--s2) 0;
    }

    .feature-list li {
      display: flex;
      align-items: center;
      gap: var(--s);
      padding: var(--s-half) 0;
    }

    .feature-list mat-icon {
      color: var(--palette-primary-500);
      flex-shrink: 0;
    }

    .privacy-note {
      color: var(--text-color-muted);
      font-size: 13px;
      margin-top: var(--s);
    }
  `,
  template: `
    <h1 mat-dialog-title>Welcome to Super Productivity!</h1>

    <mat-dialog-content>
      <p>Get organized and stay focused with:</p>

      <ul class="feature-list">
        <li>
          <mat-icon>check_circle</mat-icon>
          <span>Tasks &amp; subtasks with time estimates</span>
        </li>
        <li>
          <mat-icon>timer</mat-icon>
          <span>Built-in time tracking</span>
        </li>
        <li>
          <mat-icon>event</mat-icon>
          <span>Daily planner &amp; recurring tasks</span>
        </li>
        <li>
          <mat-icon>integration_instructions</mat-icon>
          <span>Jira, GitHub &amp; GitLab integration</span>
        </li>
      </ul>

      <p class="privacy-note">
        <mat-icon inline>lock</mat-icon>
        Your data stays on your device &mdash; no account required.
      </p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button
        mat-button
        (click)="onTour()"
      >
        Take a tour
      </button>
      <button
        mat-button
        (click)="onSkip()"
      >
        Skip
      </button>
      <button
        mat-flat-button
        color="primary"
        (click)="onAddTask()"
      >
        <mat-icon>add</mat-icon>
        Add your first task
      </button>
    </mat-dialog-actions>
  `,
})
export class WelcomeDialogComponent {
  private _dialogRef =
    inject<MatDialogRef<WelcomeDialogComponent, WelcomeDialogResult>>(MatDialogRef);

  onAddTask(): void {
    this._dialogRef.close('addTask');
  }

  onTour(): void {
    this._dialogRef.close('tour');
  }

  onSkip(): void {
    this._dialogRef.close('skip');
  }
}
