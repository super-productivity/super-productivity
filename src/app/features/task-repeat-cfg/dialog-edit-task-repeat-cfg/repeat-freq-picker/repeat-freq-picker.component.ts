import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { T } from '../../../../t.const';
import { RRULE_QUICK_SETTING } from '../../task-repeat-cfg.model';

export interface RepeatFreqOption {
  value: string;
  /** Already-translated, date-aware label (from buildRepeatQuickSettingOptions). */
  label: string;
}

const CUSTOM_VALUE = RRULE_QUICK_SETTING;
/** Roving-focus key for the "More/Fewer options" toggle — not a selectable value. */
const MORE_KEY = '__more__';

/**
 * Presentational frequency picker for the repeat-config dialog, rendered as a
 * custom dropdown (CDK overlay so the panel is never clipped by the dialog's
 * scroll container). The curated common presets show first (in `commonValues`
 * order — every day, weekly, monthly, yearly, every weekday), then "Custom",
 * then a "More options" entry that reveals the long tail IN THE OPEN PANEL
 * (clicking it does not close the dropdown). All recurrence logic — presets,
 * RRULE engine, sync-safe persistence — stays in the dialog/service; this
 * component only presents the choice.
 *
 * DEVIATION (deliberate, not an accidental reinvention of mat-select/mat-menu):
 * the defining interaction is "More options expands the long tail IN-PANEL
 * without closing", which fights both Material primitives —
 *  - `mat-select` is a value form-control with fixed option rows; it has no
 *    notion of an in-panel expandable section plus a separate "Custom" entry
 *    that switches the dialog into builder mode.
 *  - `mat-menu` closes on every `mat-menu-item` activation, does NOT match its
 *    panel width to the trigger (this picker does, via `triggerWidth`), and
 *    keeping it open for the toggle would mean mixing plain buttons with
 *    `mat-menu-item`s (breaking its arrow-key roving focus) plus width-matching
 *    CSS overrides of Material internals — exactly what the styling guide
 *    forbids.
 * A raw `cdkConnectedOverlay` (the only one in `src/app`) is therefore the
 * lighter, rule-consistent option: it owns the panel without overriding any
 * shared/Material component. Keep the recurrence/presentation split above so
 * this stays a thin, swappable view if Material ever grows a matching control.
 */
@Component({
  selector: 'repeat-freq-picker',
  templateUrl: './repeat-freq-picker.component.html',
  styleUrls: ['./repeat-freq-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, OverlayModule],
})
export class RepeatFreqPickerComponent {
  readonly T = T;
  readonly CUSTOM_VALUE = CUSTOM_VALUE;
  readonly MORE_KEY = MORE_KEY;

  readonly label = input<string>('');
  readonly options = input.required<RepeatFreqOption[]>();
  /** Preset values shown while collapsed; the rest hide behind "More options". */
  readonly commonValues = input<readonly string[]>([]);
  readonly value = input<string | undefined>(undefined);
  readonly selected = output<string>();

  readonly isOpen = signal(false);
  readonly isExpanded = signal(false);
  /** Panel width is matched to the trigger, captured when the dropdown opens. */
  readonly triggerWidth = signal(0);

  readonly overlayPositions: ConnectedPosition[] = [
    {
      originX: 'start',
      originY: 'bottom',
      overlayX: 'start',
      overlayY: 'top',
      offsetY: 4,
    },
    {
      originX: 'start',
      originY: 'top',
      overlayX: 'start',
      overlayY: 'bottom',
      offsetY: -4,
    },
  ];

  private readonly _byValue = computed(() => {
    const m = new Map<string, RepeatFreqOption>();
    for (const o of this.options()) {
      m.set(o.value, o);
    }
    return m;
  });

  readonly selectedLabel = computed<string>(() => {
    const o = this._byValue().get(this.value() ?? '');
    return o ? o.label : '';
  });

  // Presets in panel order: the curated common list first (kept in the order the
  // caller gives), then — when expanded — the long tail in build order. Custom is
  // rendered separately, last. While collapsed the active selection is appended if
  // it's a hidden tail preset, so the current choice always shows.
  readonly presets = computed<RepeatFreqOption[]>(() => {
    const byVal = this._byValue();
    const commonSet = new Set(this.commonValues());
    const head: RepeatFreqOption[] = [];
    for (const v of this.commonValues()) {
      const o = byVal.get(v);
      if (o) {
        head.push(o);
      }
    }
    if (this.isExpanded()) {
      const tail = this.options().filter(
        (o) => o.value !== CUSTOM_VALUE && !commonSet.has(o.value),
      );
      return [...head, ...tail];
    }
    const val = this.value();
    if (val && val !== CUSTOM_VALUE && !commonSet.has(val)) {
      const o = byVal.get(val);
      if (o) {
        head.push(o);
      }
    }
    return head;
  });

  readonly customOption = computed<RepeatFreqOption | undefined>(() =>
    this._byValue().get(CUSTOM_VALUE),
  );

  // Show the More/Fewer entry only when the long tail actually holds something.
  readonly canToggle = computed<boolean>(() => {
    const commonSet = new Set(this.commonValues());
    return this.options().some(
      (o) => o.value !== CUSTOM_VALUE && !commonSet.has(o.value),
    );
  });

  // --- keyboard navigation (listbox pattern; restores what the old <select> had) ---
  private readonly _optButtons = viewChildren<ElementRef<HTMLButtonElement>>('optBtn');

  /** Focusable rows in DOM/visual order: value options, then the More toggle.
   *  Drives roving tabindex + arrow-key navigation while the panel is open. */
  readonly focusableKeys = computed<string[]>(() => {
    const keys = this.presets().map((p) => p.value);
    if (this.customOption()) keys.push(CUSTOM_VALUE);
    if (this.canToggle()) keys.push(MORE_KEY);
    return keys;
  });

  /** The single tabindex=0 row (roving focus); all others are -1. */
  private readonly _focusedKey = signal<string>('');
  isFocusable(key: string): boolean {
    return key === this._focusedKey();
  }

  open(trigger: HTMLElement): void {
    this.triggerWidth.set(trigger.offsetWidth);
    const keys = this.focusableKeys();
    const val = this.value();
    // Land roving focus on the current selection (or the first row).
    this._focusedKey.set(val && keys.includes(val) ? val : (keys[0] ?? ''));
    this.isOpen.set(true);
    // Move focus into the panel once the overlay has rendered — the old native
    // <select> received focus on open; the hand-rolled panel previously did not.
    setTimeout(() => this._focusCurrent());
  }

  close(): void {
    this.isOpen.set(false);
  }

  select(value: string): void {
    this.selected.emit(value);
    this.close();
  }

  /** Toggle the long tail without closing the panel (the user's key ask). Keep
   *  focus on the toggle so a keyboard user stays put as rows appear/collapse. */
  toggleExpanded(): void {
    this.isExpanded.update((v) => !v);
    this._focusedKey.set(MORE_KEY);
    setTimeout(() => this._focusCurrent());
  }

  /** Arrow / Home / End move roving focus between the panel rows. Enter/Space
   *  activate natively (each row is a <button>); Escape is handled by the overlay. */
  onPanelKeydown(event: KeyboardEvent): void {
    const keys = this.focusableKeys();
    if (!keys.length) return;
    const cur = Math.max(0, keys.indexOf(this._focusedKey()));
    let next = cur;
    switch (event.key) {
      case 'ArrowDown':
        next = (cur + 1) % keys.length;
        break;
      case 'ArrowUp':
        next = (cur - 1 + keys.length) % keys.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = keys.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this._focusedKey.set(keys[next]);
    this._focusCurrent();
  }

  private _focusCurrent(): void {
    const idx = this.focusableKeys().indexOf(this._focusedKey());
    this._optButtons()[idx >= 0 ? idx : 0]?.nativeElement.focus();
  }
}
