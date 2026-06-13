import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface RepeatFreqOption {
  value: string;
  /** Already-translated, date-aware label (from buildRepeatQuickSettingOptions). */
  label: string;
}

/**
 * Presentational TickTick-style frequency picker for the repeat-config dialog.
 * Renders the existing quick-setting options as a chip group (instead of a
 * dropdown) and emits the selected value. All recurrence logic — presets,
 * RRULE engine, sync-safe persistence — stays in the dialog/service; this
 * component only changes how the choice is presented.
 */
@Component({
  selector: 'repeat-freq-picker',
  templateUrl: './repeat-freq-picker.component.html',
  styleUrls: ['./repeat-freq-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepeatFreqPickerComponent {
  readonly label = input<string>('');
  readonly options = input.required<RepeatFreqOption[]>();
  readonly value = input<string | undefined>(undefined);
  readonly selected = output<string>();
}
