import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { SimpleCounter, SimpleCounterType } from '../simple-counter.model';
import { SimpleCounterService } from '../simple-counter.service';
import { DateService } from '../../../core/date/date.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { T } from '../../../t.const';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { DialogSimpleCounterEditComponent } from '../dialog-simple-counter-edit/dialog-simple-counter-edit.component';
import { DialogSimpleCounterEditSettingsComponent } from '../dialog-simple-counter-edit-settings/dialog-simple-counter-edit-settings.component';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { EMPTY_SIMPLE_COUNTER } from '../simple-counter.const';
import { MatTooltipModule } from '@angular/material/tooltip';
import { moveItemInArray } from '../../../util/move-item-in-array';
import { dragDelayForTouch } from '../../../util/input-intent';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';

interface HabitDay {
  str: string;
  date: Date;
  dow: number;
  weekdayLabel?: string;
}

interface HeatmapDay {
  dateStr: string;
  value: number;
  level: number;
}

interface HeatmapColumn {
  days: HeatmapDay[];
}

interface MonthlyFrequency {
  month: string;
  value: number;
}

interface HabitStatsData {
  habitTitle: string;
  currentStreak: number;
  bestStreak: number;
  completionRate30: number;
  habitScore: number;
  totalCompletions: number;
  daysSinceStart: number;
  dailyGoal: number;
  targetDays: number;
  group: string;
  habitType: string;
  repeatMode: string;
  startDate: string;
  createdAt: string;
  updatedAt: string;
  heatmapColumns: HeatmapColumn[];
  monthlyFrequency: MonthlyFrequency[];
  historyKeys: string[];
}

@Component({
  selector: 'habit-tracker',
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    CdkDropList,
    CdkDrag,
    LocaleDatePipe,
  ],
  templateUrl: './habit-tracker.component.html',
  styleUrl: './habit-tracker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class HabitTrackerComponent {
  simpleCounters = input.required<SimpleCounter[]>();
  disabledSimpleCounters = input<SimpleCounter[]>([]);

  private _simpleCounterService = inject(SimpleCounterService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _dateService = inject(DateService);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _matDialog = inject(MatDialog);

  readonly locale = this._dateTimeFormatService.currentLocale;

  showDisabled = signal(false);

  // Statistics Modal Signals
  isStatsOpen = signal(false);
  selectedHabitId = signal<string | null>(null);
  selectedHabitStats = signal<HabitStatsData | null>(null);

  T = T;
  SimpleCounterType = SimpleCounterType;
  dragDelayForTouch = dragDelayForTouch;

  dayOffset = signal(0);

  days = computed(() => {
    const days: HabitDay[] = [];
    const isoTextLocale = this._dateTimeFormatService.isoTextLocale();
    const weekdayFormatter = isoTextLocale
      ? new Intl.DateTimeFormat(isoTextLocale, { weekday: 'short' })
      : null;
    this._globalTrackingIntervalService.todayDateStr();
    const today = this._dateService.getLogicalTodayDate();
    const offset = this.dayOffset();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i + offset);
      days.push({
        str: this._dateService.todayStr(d),
        date: d,
        dow: d.getDay(),
        weekdayLabel: weekdayFormatter?.format(d),
      });
    }
    return days;
  });

  prevWeek(): void {
    this.dayOffset.update((offset) => offset - 7);
  }

  nextWeek(): void {
    this.dayOffset.update((offset) => Math.min(0, offset + 7));
  }

  resetToToday(): void {
    this.dayOffset.set(0);
  }

  drop(event: CdkDragDrop<SimpleCounter[]>): void {
    if (event.previousIndex === event.currentIndex) {
      return;
    }
    const counters = this.simpleCounters();
    this._simpleCounterService.updateOrder(
      moveItemInArray(counters, event.previousIndex, event.currentIndex).map((c) => c.id),
    );
  }

  dateRangeLabel = computed(() => {
    const days = this.days();
    if (days.length === 0) return '';
    const first = days[0].date;
    const last = days[days.length - 1].date;

    const locale = this._dateTimeFormatService.textLocale();
    const formatOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const firstStr = first.toLocaleDateString(locale, formatOptions);
    const lastStr = last.toLocaleDateString(locale, formatOptions);

    return `${firstStr} - ${lastStr}`;
  });

  private _longPressTimer?: number;
  private _isLongPress = false;
  private _pendingLongPressAction?: { counter: SimpleCounter; date: string };

  onCellClick(counter: SimpleCounter, date: string, dow: number): void {
    if (!this.isDayEnabled(counter, dow)) {
      return;
    }
    if (this._isLongPress) {
      this._isLongPress = false;
      return;
    }

    const currentValue = this.getVal(counter, date);

    if (
      counter.type === SimpleCounterType.ClickCounter ||
      counter.type === SimpleCounterType.RepeatedCountdownReminder
    ) {
      const newVal =
        this.isSimpleCompletion(counter) && currentValue > 0 ? 0 : currentValue + 1;
      this._simpleCounterService.setCounterForDate(counter.id, date, newVal);
    } else {
      this.openEditDialog(counter, date);
    }
  }

  onCellContextMenu(
    event: MouseEvent,
    counter: SimpleCounter,
    date: string,
    dow: number,
  ): void {
    event.preventDefault();
    if (!this.isDayEnabled(counter, dow)) {
      return;
    }
    this.openEditDialog(counter, date);
  }

  onPressStart(counter: SimpleCounter, date: string, dow: number): void {
    if (!this.isDayEnabled(counter, dow)) {
      return;
    }
    this._isLongPress = false;
    this._pendingLongPressAction = undefined;
    this._longPressTimer = window.setTimeout(() => {
      this._isLongPress = true;
      this._pendingLongPressAction = { counter, date };
    }, 700);
  }

  onPressEnd(): void {
    if (this._longPressTimer) {
      window.clearTimeout(this._longPressTimer);
      this._longPressTimer = undefined;
    }

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

  isDayEnabled(counter: SimpleCounter, dow: number): boolean {
    if (!counter.isTrackStreaks || counter.streakMode === 'weekly-frequency') {
      return true;
    }
    if (!counter.streakWeekDays) {
      return true;
    }
    return !!counter.streakWeekDays[dow];
  }

  isSimpleCompletion(counter: SimpleCounter): boolean {
    return (
      counter.type === SimpleCounterType.ClickCounter &&
      !!counter.isTrackStreaks &&
      (!counter.streakMinValue || counter.streakMinValue === 1)
    );
  }

  getVal(counter: SimpleCounter, day: string): number {
    return counter.countOnDay?.[day] ?? 0;
  }

  getDisplayValue(counter: SimpleCounter, day: string): string {
    const value = this.getVal(counter, day);
    if (value === 0) return '';

    if (this.isSimpleCompletion(counter)) {
      return '';
    }

    if (counter.type === SimpleCounterType.StopWatch) {
      const minutes = Math.round(value / 60000);
      if (minutes < 60) {
        return `${minutes}m`;
      } else {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
      }
    }

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

  enableHabit(id: string): void {
    this._simpleCounterService.updateSimpleCounter(id, { isEnabled: true });
  }

  deleteHabit(counter: SimpleCounter): void {
    this._matDialog
      .open(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          message: T.F.SIMPLE_COUNTER.D_CONFIRM_REMOVE.MSG,
          okTxt: T.F.SIMPLE_COUNTER.D_CONFIRM_REMOVE.OK,
        },
      })
      .afterClosed()
      .subscribe((confirmed: boolean) => {
        if (confirmed) {
          this._simpleCounterService.deleteSimpleCounter(counter.id);
        }
      });
  }

  // Statistics Modal Actions & Logic
  openStatsModal(): void {
    this.isStatsOpen.set(true);
    const counters = this.simpleCounters();
    if (counters && counters.length > 0) {
      this.selectedHabitId.set(counters[0].id);
      this._updateStatsForHabit(counters[0]);
    }
  }

  closeStatsModal(): void {
    this.isStatsOpen.set(false);
  }

  onHabitSelect(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const habitId = target.value;
    this.selectedHabitId.set(habitId);
    const counters = this.simpleCounters();
    const habit = counters.find((c) => c.id === habitId);
    if (habit) {
      this._updateStatsForHabit(habit);
    }
  }

  private _updateStatsForHabit(habit: SimpleCounter): void {
    const historyObj = habit.countOnDay || {};
    const minVal = habit.streakMinValue || 1;
    const activeDates = Object.keys(historyObj)
      .filter((dateStr) => historyObj[dateStr] >= minVal)
      .sort();

    const totalCompletions = activeDates.length;

    let currentStreak = 0;
    let bestStreak = 0;

    if (activeDates.length > 0) {
      const activeSet = new Set(activeDates);
      const today = new Date();

      const checkDate = new Date(today);
      let dateStr = this._dateService.todayStr(checkDate);

      if (!activeSet.has(dateStr)) {
        checkDate.setDate(checkDate.getDate() - 1);
        dateStr = this._dateService.todayStr(checkDate);
      }

      while (activeSet.has(dateStr)) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
        dateStr = this._dateService.todayStr(checkDate);
      }

      let tempStreak = 0;
      let prevDate: Date | null = null;

      for (const dStr of activeDates) {
        const curDate = new Date(dStr);
        if (prevDate) {
          const diffDays = Math.round(
            (curDate.getTime() - prevDate.getTime()) / (1000 * 3600 * 24),
          );
          if (diffDays === 1) {
            tempStreak++;
          } else {
            tempStreak = 1;
          }
        } else {
          tempStreak = 1;
        }
        bestStreak = Math.max(bestStreak, tempStreak);
        prevDate = curDate;
      }
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = this._dateService.todayStr(thirtyDaysAgo);

    const completionsLast30 = activeDates.filter((d) => d >= thirtyDaysAgoStr).length;
    const completionRate30 = Math.min(100, Math.round((completionsLast30 / 30) * 100));

    const rateScore = completionRate30 * 0.7;
    const streakScore = currentStreak * 3;
    const habitScore = Math.min(100, Math.round(rateScore + streakScore));

    // Calculate Days since start
    const today = new Date();
    const startDate = habit.startDate ? new Date(habit.startDate) : new Date(today);
    const diffTime = Math.abs(today.getTime() - startDate.getTime());
    const msInDay = 1000 * 60 * 60 * 24;
    const daysSinceStart = Math.max(1, Math.ceil(diffTime / msInDay));

    // Generate Heatmap Matrix Columns (18 Weeks)
    const heatmapColumns: HeatmapColumn[] = [];
    const endDate = new Date(today);
    const numCols = 18;

    for (let colIndex = numCols - 1; colIndex >= 0; colIndex--) {
      const columnDays: HeatmapDay[] = [];
      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const targetDate = new Date(endDate);
        const weekOffset = colIndex * 7;
        const daysBack = weekOffset + 6 - dayIndex;
        targetDate.setDate(targetDate.getDate() - daysBack);
        const dStr = this._dateService.todayStr(targetDate);
        const val = historyObj[dStr] || 0;

        let level = 0;
        if (val >= minVal * 2) level = 3;
        else if (val >= minVal) level = 2;
        else if (val > 0) level = 1;

        columnDays.push({ dateStr: dStr, value: val, level });
      }
      heatmapColumns.push({ days: columnDays });
    }

    // Generate Monthly Frequency Chart
    const monthlyFrequency: MonthlyFrequency[] = [];
    for (let m = 5; m >= 0; m--) {
      const d = new Date(today.getFullYear(), today.getMonth() - m, 1);
      const monthLabel = d.toLocaleString('en-US', { month: 'short' });
      const yearMonthPrefix = this._dateService.todayStr(d).substring(0, 7);

      const count = activeDates.filter((dateKey) =>
        dateKey.startsWith(yearMonthPrefix),
      ).length;
      monthlyFrequency.push({ month: monthLabel, value: count });
    }

    this.selectedHabitStats.set({
      habitTitle: habit.title,
      currentStreak,
      bestStreak,
      completionRate30,
      habitScore,
      totalCompletions,
      daysSinceStart,
      dailyGoal: habit.streakMinValue || 1,
      targetDays: habit.targetDays || 365,
      group: habit.group || 'Health',
      habitType: habit.habitType || 'Positive',
      repeatMode: habit.repeatMode || 'Daily',
      startDate: habit.startDate || '1/1/2026',
      createdAt: habit.createdAt || 'Just now',
      updatedAt: habit.updatedAt || 'Just now',
      heatmapColumns,
      monthlyFrequency,
      historyKeys: activeDates,
    });
  }

  exportHabitToExcel(): void {
    const stats = this.selectedHabitStats();
    if (!stats) return;

    let csvContent = '\uFEFF';

    csvContent += `Habit Statistics Report: ${stats.habitTitle}\n\n`;
    csvContent += `Metric,Value\n`;
    csvContent += `Habit Name,${stats.habitTitle}\n`;
    csvContent += `Group,${stats.group}\n`;
    csvContent += `Type,${stats.habitType}\n`;
    csvContent += `Repeat Mode,${stats.repeatMode}\n`;
    csvContent += `Start Date,${stats.startDate}\n`;
    csvContent += `Days Since Start,${stats.daysSinceStart}\n`;
    csvContent += `Current Streak,${stats.currentStreak} Days\n`;
    csvContent += `Best Streak,${stats.bestStreak} Days\n`;
    csvContent += `30-Day Completion Rate,${stats.completionRate30}%\n`;
    csvContent += `Habit Score,${stats.habitScore} / 100\n`;
    csvContent += `Total Completions,${stats.totalCompletions}\n\n`;

    csvContent += `Completion History Log\n`;
    csvContent += `Date\n`;
    stats.historyKeys.forEach((date: string) => {
      csvContent += `${date}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `${stats.habitTitle.replace(/\s+/g, '_')}_Statistics.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
