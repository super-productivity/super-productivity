import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostBinding,
  HostListener,
  inject,
  Input,
  output,
} from '@angular/core';
import { MatRipple } from '@angular/material/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
  MatExpansionPanel,
  MatExpansionPanelHeader,
  MatExpansionPanelTitle,
} from '@angular/material/expansion';
import { isInputElement } from '../../../../util/dom-element';

@Component({
  selector: 'task-detail-item',
  templateUrl: './task-detail-item.component.html',
  styleUrls: ['./task-detail-item.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatRipple,
    MatIconButton,
    MatIcon,
    MatExpansionPanel,
    MatExpansionPanelHeader,
    MatExpansionPanelTitle,
  ],
})
export class TaskDetailItemComponent {
  elementRef = inject(ElementRef);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  @Input() type: 'input' | 'fullSizeInput' | 'panel' = 'input';
  // TODO: Skipped for migration because:
  //  Your application code writes to the input. This prevents migration.
  @Input() expanded: boolean = false;
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  @Input() inputIcon?: string;

  readonly collapseParent = output<void>();
  readonly keyPress = output<KeyboardEvent>();
  // Emits when the expansion state changes (header click, keyboard, or
  // programmatic), so a parent can keep a controlling signal in sync.
  readonly expandedChange = output<boolean>();
  // Emits once the expand animation has finished, so a parent can focus content
  // that is only focusable after the panel body becomes visible.
  readonly afterExpand = output<void>();
  readonly editActionTriggered = output<void>();

  @HostBinding('tabindex') readonly tabindex: number = 3;

  @HostListener('keydown', ['$event']) onKeyDown(ev: KeyboardEvent): void {
    // Skip handling inside input elements
    const targetEl = ev.target as HTMLElement;
    if (isInputElement(targetEl)) return;

    this.keyPress.emit(ev);
    if (ev.code === 'Escape') {
      this.collapseParent.emit();
    } else if (ev.key === 'ArrowRight' || ev.key === 'Enter') {
      if (this.type === 'panel') {
        if (this.expanded) {
          this.editActionTriggered.emit();
        } else {
          this.expanded = true;
        }
      } else {
        this.editActionTriggered.emit();
      }
    } else if (ev.key === 'ArrowLeft') {
      if (this.expanded) {
        this.expanded = false;
      } else {
        this.collapseParent.emit();
      }
    }
  }

  focusEl(): void {
    this.elementRef.nativeElement.focus();
  }

  onInputItemClick(): void {
    this.editActionTriggered.emit();
    this.focusEl();
  }
}
