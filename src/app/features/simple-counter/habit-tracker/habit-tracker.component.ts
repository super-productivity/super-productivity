import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SimpleCounter, SimpleCounterType } from '../simple-counter.model';
import { SimpleCounterService } from '../simple-counter.service';
import { DateService } from '../../../core/date/date.service';
import { T } from '../../../t.const';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { DialogSimpleCounterEditComponent } from '../dialog-simple-counter-edit/dialog-simple-counter-edit.component';
import { DialogSimpleCounterEditSettingsComponent } from '../dialog-simple-counter-edit-settings/dialog-simple-counter-edit-settings.component';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { EMPTY_SIMPLE_COUNTER } from '../simple-counter.const';
import { MatTooltipModule } from '@angular/material/tooltip';
import { loadFromRealLs, saveToRealLs } from '../../../core/persistence/local-storage';
import { LS } from '../../../core/persistence/storage-keys.const';

@Component({
  selector: 'habit-tracker',
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    MatButtonModule,
    MatIconModule,
    MsToStringPipe,
    MatTooltipModule,
  ],
  templateUrl: './habit-tracker.component.html',
  styleUrl: './habit-tracker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HabitTrackerComponent {
  simpleCounters = input.required<SimpleCounter[]>();

  private _simpleCounterService = inject(SimpleCounterService);
  private _dateService = inject(DateService);
  private _matDialog = inject(MatDialog);
  private _router = inject(Router);

  T = T;
  SimpleCounterType = SimpleCounterType;

  dayOffset = signal(0);
  isCompactView = signal(false);

  constructor() {
    // Load initial compact view state from localStorage
    const savedCompactView = loadFromRealLs(LS.HABIT_TRACKER_COMPACT_VIEW) as
      | { value: boolean }
      | undefined;
    if (savedCompactView && typeof savedCompactView.value === 'boolean') {
      this.isCompactView.set(savedCompactView.value);
    }

    // Persist compact view state changes to localStorage
    effect(() => {
      saveToRealLs(LS.HABIT_TRACKER_COMPACT_VIEW, { value: this.isCompactView() });
    });
  }

  days = computed(() => {
    const days: string[] = [];
    const today = new Date();
    const offset = this.dayOffset();
    const daysToShow = this.isCompactView() ? 3 : 6; // Show 4 days (0-3) or 7 days (0-6)
    for (let i = daysToShow; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i + offset);
      days.push(this._dateService.todayStr(d));
    }
    return days;
  });

  prevWeek(): void {
    const step = this.isCompactView() ? 4 : 7;
    this.dayOffset.update((offset) => offset - step);
  }

  nextWeek(): void {
    const step = this.isCompactView() ? 4 : 7;
    this.dayOffset.update((offset) => Math.min(0, offset + step));
  }

  resetToToday(): void {
    this.dayOffset.set(0);
  }

  toggleCompactView(): void {
    this.isCompactView.update((compact) => !compact);
  }

  dateRangeLabel = computed(() => {
    const days = this.days();
    if (days.length === 0) return '';
    const first = this.parseDateLocal(days[0]);
    const last = this.parseDateLocal(days[days.length - 1]);

    const formatOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const firstStr = first.toLocaleDateString(undefined, formatOptions);
    const lastStr = last.toLocaleDateString(undefined, formatOptions);

    return `${firstStr} - ${lastStr}`;
  });

  parseDateLocal(dateStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private _longPressTimer?: number;
  private _isLongPress = false;
  private _pendingLongPressAction?: { counter: SimpleCounter; date: string };

  onCellClick(counter: SimpleCounter, date: string): void {
    if (this._isLongPress) {
      this._isLongPress = false;
      return;
    }

    const currentValue = this.getVal(counter, date);

    if (
      counter.type === SimpleCounterType.ClickCounter ||
      counter.type === SimpleCounterType.RepeatedCountdownReminder
    ) {
      // Increment for ClickCounters on left click
      const newVal = currentValue + 1;
      this._simpleCounterService.setCounterForDate(counter.id, date, newVal);
    } else {
      // For StopWatch or others, open dialog on left click
      this.openEditDialog(counter, date);
    }
  }

  onCellContextMenu(event: MouseEvent, counter: SimpleCounter, date: string): void {
    event.preventDefault(); // Prevent default browser context menu
    this.openEditDialog(counter, date);
  }

  onPressStart(counter: SimpleCounter, date: string): void {
    this._isLongPress = false;
    this._pendingLongPressAction = undefined;
    this._longPressTimer = window.setTimeout(() => {
      this._isLongPress = true;
      this._pendingLongPressAction = { counter, date };
    }, 700); // 700ms for long press
  }

  onPressEnd(): void {
    if (this._longPressTimer) {
      window.clearTimeout(this._longPressTimer);
      this._longPressTimer = undefined;
    }

    // If long press was triggered, open dialog on release
    if (this._pendingLongPressAction) {
      const { counter, date } = this._pendingLongPressAction;
      this._pendingLongPressAction = undefined;
      this.openEditDialog(counter, date);
    }
  }

  openEditDialog(counter: SimpleCounter, date: string): void {
    const counterCopy = {
      ...counter,
      countOnDay: { ...counter.countOnDay },
    };

    this._matDialog.open(DialogSimpleCounterEditComponent, {
      data: { simpleCounter: counterCopy, selectedDate: date },
      restoreFocus: true,
    });
  }

  isSimpleCompletion(counter: SimpleCounter): boolean {
    // Simple completion: ClickCounter type with no specific goal or goal of 1
    return (
      counter.type === SimpleCounterType.ClickCounter &&
      (!counter.streakMinValue || counter.streakMinValue === 1)
    );
  }

  getVal(counter: SimpleCounter, day: string): number {
    return counter.countOnDay[day] || 0;
  }

  getDisplayValue(counter: SimpleCounter, day: string): string {
    const value = this.getVal(counter, day);
    if (value === 0) return '';

    // For simple completion, just show checkmark (handled in template)
    if (this.isSimpleCompletion(counter)) {
      return '';
    }

    // For StopWatch, show time
    if (counter.type === SimpleCounterType.StopWatch) {
      // Convert ms to minutes for display
      const minutes = Math.round(value / 60000);
      if (minutes < 60) {
        return `${minutes}m`;
      } else {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
      }
    }

    // For ClickCounter with specific values, show the count
    return value.toString();
  }

  getProgress(counter: SimpleCounter, day: string): number {
    const value = this.getVal(counter, day);
    if (value === 0) return 0;

    const goal = counter.streakMinValue || 1;
    return Math.min(100, (value / goal) * 100);
  }

  addHabit(): void {
    const newHabit = {
      ...EMPTY_SIMPLE_COUNTER,
      isEnabled: true,
    };

    this._matDialog.open(DialogSimpleCounterEditSettingsComponent, {
      data: { simpleCounter: newHabit },
      restoreFocus: true,
      width: '600px',
    });
  }

  openEditSettings(counter: SimpleCounter): void {
    const counterCopy = {
      ...counter,
      countOnDay: { ...counter.countOnDay },
    };

    this._matDialog.open(DialogSimpleCounterEditSettingsComponent, {
      data: { simpleCounter: counterCopy },
      restoreFocus: true,
      width: '600px',
    });
  }

  openManageHabits(): void {
    this._router.navigate(['/config'], {
      queryParams: { tab: 3, section: 'SIMPLE_COUNTER_CFG' },
    });
  }
}
