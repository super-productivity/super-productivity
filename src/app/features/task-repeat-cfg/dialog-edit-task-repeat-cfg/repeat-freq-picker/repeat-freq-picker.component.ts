import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../../t.const';

export interface RepeatFreqOption {
  value: string;
  /** Already-translated, date-aware label (from buildRepeatQuickSettingOptions). */
  label: string;
}

const CUSTOM_VALUE = 'RRULE';

/**
 * Presentational TickTick-style frequency picker for the repeat-config dialog.
 * Shows a curated set of common presets as a chip group; the long tail is
 * revealed with a "More options" toggle, and "Custom" always sits last. All
 * recurrence logic — presets, RRULE engine, sync-safe persistence — stays in
 * the dialog/service; this component only presents the choice.
 */
@Component({
  selector: 'repeat-freq-picker',
  templateUrl: './repeat-freq-picker.component.html',
  styleUrls: ['./repeat-freq-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
})
export class RepeatFreqPickerComponent {
  readonly T = T;

  readonly label = input<string>('');
  readonly options = input.required<RepeatFreqOption[]>();
  /** Preset values shown while collapsed; the rest hide behind "More options". */
  readonly commonValues = input<readonly string[]>([]);
  readonly value = input<string | undefined>(undefined);
  readonly selected = output<string>();

  readonly isExpanded = signal(false);

  // Common presets + the currently-selected one (so the active choice is always
  // visible even if it's a "more" option). Custom is rendered separately, last.
  readonly visiblePresets = computed<RepeatFreqOption[]>(() => {
    const all = this.options().filter((o) => o.value !== CUSTOM_VALUE);
    if (this.isExpanded()) {
      return all;
    }
    const common = new Set(this.commonValues());
    const val = this.value();
    return all.filter((o) => common.has(o.value) || o.value === val);
  });

  readonly customOption = computed<RepeatFreqOption | undefined>(() =>
    this.options().find((o) => o.value === CUSTOM_VALUE),
  );

  // Show the More/Fewer toggle only when something is actually hidden collapsed.
  readonly canToggle = computed<boolean>(() => {
    const common = new Set(this.commonValues());
    const val = this.value();
    const collapsedCount = this.options().filter(
      (o) => o.value !== CUSTOM_VALUE && (common.has(o.value) || o.value === val),
    ).length;
    const presetCount = this.options().filter((o) => o.value !== CUSTOM_VALUE).length;
    return presetCount > collapsedCount;
  });

  toggleExpanded(): void {
    this.isExpanded.update((v) => !v);
  }
}
