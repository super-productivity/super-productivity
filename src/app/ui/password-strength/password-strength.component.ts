import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../t.const';

export type PasswordStrengthLevel = 'weak' | 'fair' | 'strong';

@Component({
  selector: 'password-strength',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (password()) {
      <div class="strength-bar">
        <div
          class="strength-fill"
          [class.weak]="level() === 'weak'"
          [class.fair]="level() === 'fair'"
          [class.strong]="level() === 'strong'"
          [style.width.%]="fillPercent()"
        ></div>
      </div>
      <span
        class="strength-label"
        [class.weak]="level() === 'weak'"
        [class.fair]="level() === 'fair'"
        [class.strong]="level() === 'strong'"
        >{{ label() }}</span
      >
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: -8px;
        margin-bottom: 8px;
      }

      .strength-bar {
        flex: 1;
        height: 4px;
        background: rgba(128, 128, 128, 0.2);
        border-radius: 2px;
        overflow: hidden;
      }

      .strength-fill {
        height: 100%;
        border-radius: 2px;
        transition: width 0.3s ease;

        &.weak {
          background: var(--c-warn);
        }

        &.fair {
          background: var(--c-accent);
        }

        &.strong {
          background: var(--palette-primary-500);
        }
      }

      .strength-label {
        font-size: 12px;
        white-space: nowrap;

        &.weak {
          color: var(--c-warn);
        }

        &.fair {
          color: var(--c-accent);
        }

        &.strong {
          color: var(--palette-primary-500);
        }
      }
    `,
  ],
})
export class PasswordStrengthComponent {
  private _translateService = inject(TranslateService);

  password = input<string>('');
  minLength = input<number>(8);

  level = computed<PasswordStrengthLevel>(() => {
    const pwd = this.password();
    if (!pwd || pwd.length < this.minLength()) {
      return 'weak';
    }
    let score = 0;
    if (pwd.length >= 12) score++;
    if (pwd.length >= 16) score++;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[^a-zA-Z0-9]/.test(pwd)) score++;
    if (score >= 4) return 'strong';
    if (score >= 2) return 'fair';
    return 'weak';
  });

  fillPercent = computed(() => {
    switch (this.level()) {
      case 'weak':
        return 33;
      case 'fair':
        return 66;
      case 'strong':
        return 100;
    }
  });

  label = computed(() => {
    switch (this.level()) {
      case 'weak':
        return this._translateService.instant(T.G.PASSWORD_STRENGTH_WEAK);
      case 'fair':
        return this._translateService.instant(T.G.PASSWORD_STRENGTH_FAIR);
      case 'strong':
        return this._translateService.instant(T.G.PASSWORD_STRENGTH_STRONG);
    }
  });
}
