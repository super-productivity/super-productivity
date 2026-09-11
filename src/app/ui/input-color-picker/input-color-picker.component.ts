import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  ConnectedPosition,
} from '@angular/cdk/overlay';
import { PRESET_COLORS } from '../work-context-color';
import { MatIcon } from '@angular/material/icon';

const PANEL_GAP = 4;
const VIEWPORT_MARGIN = 8;

@Component({
  selector: 'input-color-picker',
  templateUrl: './input-color-picker.component.html',
  styleUrls: ['./input-color-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, CdkOverlayOrigin, CdkConnectedOverlay],
})
export class InputColorPickerComponent {
  readonly value = input<string>('#000000');
  readonly label = input<string>('');
  readonly valueChange = output<string>();

  readonly presetColors = PRESET_COLORS;
  readonly nativeInput = viewChild<ElementRef<HTMLInputElement>>('nativeInput');
  readonly isOpen = signal(false);
  readonly isPresetColor = computed(() => this.presetColors.includes(this.value()));

  readonly viewportMargin = VIEWPORT_MARGIN;

  // Below the trigger, flipping above when there is no room.
  readonly panelPositions: ConnectedPosition[] = [
    {
      originX: 'start',
      originY: 'bottom',
      overlayX: 'start',
      overlayY: 'top',
      offsetY: PANEL_GAP,
    },
    {
      originX: 'start',
      originY: 'top',
      overlayX: 'start',
      overlayY: 'bottom',
      offsetY: -PANEL_GAP,
    },
  ];

  toggle(): void {
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
}
