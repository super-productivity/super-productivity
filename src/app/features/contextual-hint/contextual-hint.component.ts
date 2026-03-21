import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ContextualHint } from './contextual-hint.model';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { animate, style, transition, trigger } from '@angular/animations';
import { ANI_ENTER_TIMING, ANI_LEAVE_TIMING } from '../../ui/animations/animation.const';

@Component({
  selector: 'contextual-hint',
  standalone: true,
  imports: [MatIcon, MatIconButton],
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
      @slideUp
    >
      <button
        mat-icon-button
        class="dismiss-btn"
        (click)="dismissed.emit()"
      >
        <mat-icon>close</mat-icon>
      </button>
      <div class="hint-content">
        <mat-icon class="hint-icon">{{ hint().icon }}</mat-icon>
        <div class="hint-text">
          <div class="hint-title">{{ hint().title }}</div>
          <div class="hint-message">{{ hint().message }}</div>
        </div>
      </div>
      @if (hint().actionLabel) {
        <button
          class="hint-action"
          (click)="actionClicked.emit()"
        >
          {{ hint().actionLabel }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      bottom: var(--s2);
      right: var(--s2);
      z-index: 10;
      pointer-events: none;
    }

    .contextual-hint-card {
      pointer-events: auto;
      background: var(--card-bg);
      border-radius: 12px;
      box-shadow: var(--whiteframe-shadow-6dp);
      padding: var(--s2);
      max-width: 340px;
      position: relative;
    }

    .dismiss-btn {
      position: absolute;
      top: var(--s-quarter);
      right: var(--s-quarter);
      --mdc-icon-button-icon-size: 18px;
      width: 28px;
      height: 28px;
      padding: 0;
    }

    .hint-content {
      display: flex;
      align-items: flex-start;
      gap: var(--s);
      padding-right: var(--s2);
    }

    .hint-icon {
      color: var(--color-primary-600);
      flex-shrink: 0;
      margin-top: 2px;
    }

    .hint-title {
      font-weight: 500;
      margin-bottom: var(--s-quarter);
    }

    .hint-message {
      font-size: 13px;
      opacity: 0.8;
      line-height: 1.4;
    }

    .hint-action {
      display: block;
      margin-top: var(--s);
      margin-left: auto;
      background: none;
      border: none;
      color: var(--color-primary-600);
      font-weight: 500;
      cursor: pointer;
      padding: var(--s-half) var(--s);
      border-radius: 4px;
      font-size: 13px;
    }

    .hint-action:hover {
      background: var(--bg-darker);
    }
  `,
})
export class ContextualHintComponent {
  hint = input.required<ContextualHint>();
  dismissed = output<void>();
  actionClicked = output<void>();
}
