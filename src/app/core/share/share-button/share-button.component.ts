import { Component, ChangeDetectionStrategy, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ShareService } from '../share.service';
import { SharePayload } from '../share.model';

/**
 * Reusable share button component
 * Can be placed anywhere in the app to trigger sharing
 */
@Component({
  selector: 'share-button',
  template: `
    <button
      mat-icon-button
      type="button"
      [matTooltip]="tooltip()"
      (click)="share()"
      [disabled]="disabled()"
    >
      <mat-icon>share</mat-icon>
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      button {
        opacity: 0.7;
        transition: opacity var(--transition-duration-s) ease-in-out;
      }

      button:hover,
      button:focus-visible,
      button:active {
        opacity: 1;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
})
export class ShareButtonComponent {
  private _shareService = inject(ShareService);

  /** The payload to share when button is clicked */
  readonly payload = input.required<SharePayload>();

  /** Tooltip text (default: 'Share') */
  readonly tooltip = input<string>('Share');

  /** Whether button is disabled */
  readonly disabled = input<boolean>(false);

  /**
   * Trigger share action
   */
  async share(): Promise<void> {
    await this._shareService.share(this.payload());
  }
}
