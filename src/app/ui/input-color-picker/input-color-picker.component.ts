import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { PRESET_COLORS } from '../../features/work-context/work-context-color';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'input-color-picker',
  templateUrl: './input-color-picker.component.html',
  styleUrls: ['./input-color-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon],
})
export class InputColorPickerComponent {
  readonly value = input<string>('#000000');
  readonly label = input<string>('');
  readonly valueChange = output<string>();

  readonly presetColors = PRESET_COLORS;
  readonly nativeInput = viewChild<ElementRef<HTMLInputElement>>('nativeInput');
  readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  readonly isOpen = signal(false);
  readonly isPresetColor = computed(() => this.presetColors.includes(this.value()));

  panelTop = '';
  panelLeft = '';

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) {
      this.isOpen.set(false);
    }
  }

  toggle(): void {
    if (!this.isOpen()) {
      this._updatePanelPosition();
    }
    this.isOpen.update((v) => !v);
  }

  selectColor(color: string): void {
    this.valueChange.emit(color);
    this.isOpen.set(false);
  }

  openNativePicker(): void {
    this.isOpen.set(false);
    this.nativeInput()?.nativeElement.click();
  }

  onNativeChange(event: Event): void {
    const el = event.target as HTMLInputElement;
    this.valueChange.emit(el.value);
  }

  private _updatePanelPosition(): void {
    const rect = this.trigger()?.nativeElement.getBoundingClientRect();
    if (!rect) return;

    const panelWidth = 196;
    const panelHeight = 160;
    const gap = 4;

    const spaceRight = window.innerWidth - rect.left;
    const left =
      spaceRight >= panelWidth ? rect.left : window.innerWidth - panelWidth - 8;

    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow >= panelHeight + gap ? rect.bottom + gap : rect.top - panelHeight - gap;

    this.panelTop = `${top}px`;
    this.panelLeft = `${left}px`;
  }
}
