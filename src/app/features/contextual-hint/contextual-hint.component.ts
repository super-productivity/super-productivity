import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  input,
  output,
} from '@angular/core';
import { ContextualHint } from './contextual-hint.model';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { animate, style, transition, trigger } from '@angular/animations';
import { ANI_ENTER_TIMING, ANI_LEAVE_TIMING } from '../../ui/animations/animation.const';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'contextual-hint',
  standalone: true,
  imports: [MatIcon, MatIconButton, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('slideUp', [
      transition(':enter', [
        style({ transform: 'translateY(100%)', opacity: 0 }),
        animate(ANI_ENTER_TIMING, style({ transform: 'translateY(0)', opacity: 1 })),
      ]),
      transition(':leave', [
        animate(ANI_LEAVE_TIMING, style({ transform: 'translateY(100%)', opacity: 0 })),
      ]),
    ]),
  ],
  template: `
    <div
      class="contextual-hint-card"
      role="status"
      aria-live="polite"
      @slideUp
    >
      <button
        mat-icon-button
        class="dismiss-btn"
        [attr.aria-label]="'CONTEXTUAL_HINT.DISMISS' | translate"
        (click)="dismissed.emit()"
      >
        <mat-icon>close</mat-icon>
      </button>
      <div class="hint-content">
        <mat-icon class="hint-icon">{{ hint().icon }}</mat-icon>
        <div class="hint-text">
          <div class="hint-title">{{ hint().titleKey | translate }}</div>
          <div class="hint-message">{{ hint().messageKey | translate }}</div>
        </div>
      </div>
      @if (hint().actionLabelKey) {
        <button
          class="hint-action"
          (click)="actionClicked.emit()"
        >
          {{ hint().actionLabelKey | translate }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      bottom: var(--s2);
      inset-inline-end: var(--s2);
      z-index: var(--z-banner);
      pointer-events: none;
      max-width: calc(100vw - var(--s4));
    }

    :host-context(.has-mobile-bottom-nav) {
      bottom: calc(var(--bar-height) + var(--s2) + var(--s2));
    }

    .contextual-hint-card {
      pointer-events: auto;
      background: var(--card-bg);
      border-radius: var(--card-border-radius);
      box-shadow: var(--whiteframe-shadow-6dp);
      padding: var(--s2);
      max-width: 340px;
      position: relative;
    }

    .dismiss-btn {
      position: absolute;
      top: var(--s-quarter);
      inset-inline-end: var(--s-quarter);
      --mdc-icon-button-icon-size: 18px;
      width: 28px;
      height: 28px;
      padding: 0;
    }

    .hint-content {
      display: flex;
      align-items: flex-start;
      gap: var(--s);
      padding-inline-end: var(--s2);
    }

    .hint-icon {
      color: var(--color-primary-600);
      flex-shrink: 0;
      margin-top: var(--s-quarter);
    }

    .hint-title {
      font-weight: 500;
      margin-bottom: var(--s-quarter);
    }

    .hint-message {
      font-size: var(--font-size-s, 13px);
      color: var(--text-color-secondary, inherit);
      line-height: 1.4;
    }

    .hint-action {
      display: block;
      margin-top: var(--s);
      margin-inline-start: auto;
      background: none;
      border: none;
      color: var(--color-primary-600);
      font-weight: 500;
      cursor: pointer;
      padding: var(--s-half) var(--s);
      border-radius: var(--card-border-radius);
      font-size: var(--font-size-s, 13px);
    }

    .hint-action:hover,
    .hint-action:focus-visible {
      background: var(--bg-darker);
    }

    .hint-action:focus-visible {
      outline: 2px solid var(--color-primary-600);
      outline-offset: 2px;
    }
  `,
})
export class ContextualHintComponent {
  hint = input.required<ContextualHint>();
  dismissed = output<void>();
  actionClicked = output<void>();

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (!event.defaultPrevented) {
      this.dismissed.emit();
    }
  }
}
