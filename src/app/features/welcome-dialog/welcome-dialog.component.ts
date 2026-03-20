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
  template: `
    <h1 mat-dialog-title>Welcome to Super Productivity!</h1>

    <mat-dialog-content>
      <p>
        A todo list &amp; time tracker that respects your privacy.
        <strong>Your data stays on your device</strong> &mdash; no account required.
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
