import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';

/** Text button that opens and closes a `help-section`. */
@Component({
  selector: 'help-toggle-btn',
  template: `<button
    mat-button
    type="button"
    [attr.aria-expanded]="isOpen()"
    (click)="toggle($event)"
  >
    <mat-icon>help_outline</mat-icon>{{ T.G.HELP | translate }}
  </button>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatIcon, TranslatePipe],
})
export class HelpToggleBtnComponent {
  readonly isOpen = model(false);
  readonly T = T;

  toggle(ev: MouseEvent): void {
    // Inside a collapsible header: marks the click handled so the section
    // doesn't collapse, without stopping it for document listeners.
    ev.preventDefault();
    this.isOpen.update((isOpen) => !isOpen);
  }
}
