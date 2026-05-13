import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import { DividerBlock } from '../document-block.model';

@Component({
  selector: 'document-divider-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <hr
      #dividerEl
      tabindex="0"
      (keydown)="onKeydown($event)"
    />
  `,
  styles: [
    `
      :host {
        display: block;
        padding: var(--s) 0;
      }

      hr {
        border: none;
        border-top: 1px solid var(--text-color-muted);
        opacity: 0.3;
        margin: 0;
        outline: none;
        cursor: pointer;
      }

      hr:focus {
        opacity: 0.6;
        border-top-color: var(--palette-primary-500, #6495ed);
      }
    `,
  ],
})
export class DocumentDividerBlockComponent {
  block = input.required<DividerBlock>();
  enterPressed = output<void>();
  deleteBlock = output<void>();
  navigateUp = output<void>();
  navigateDown = output<void>();

  dividerEl = viewChild<ElementRef<HTMLHRElement>>('dividerEl');

  focus(): void {
    this.dividerEl()?.nativeElement.focus();
  }

  onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Backspace' || ev.key === 'Delete') {
      ev.preventDefault();
      this.deleteBlock.emit();
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.navigateUp.emit();
    }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.navigateDown.emit();
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      this.enterPressed.emit();
    }
  }
}
