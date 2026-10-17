import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import {
  DurationAdjustmentResult,
  DurationAdjustmentType,
  MarkTaskDoneDialogData,
  MarkTaskDoneDialogResult,
  SchedulePlacementType,
  TASK_DONE_DEFAULT_MIN_DURATION_MS,
} from './dialog-mark-task-done.model';
import {
  formatDuration,
  formatTime12h,
  parseCustomTimeString,
} from './parse-custom-time-string.util';

@Component({
  selector: 'dialog-mark-task-done',
  templateUrl: './dialog-mark-task-done.component.html',
  styleUrls: ['./dialog-mark-task-done.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIcon, MatButtonModule, MatDialogModule],
})
export class DialogMarkTaskDoneComponent implements OnInit {
  readonly data: MarkTaskDoneDialogData = inject(MAT_DIALOG_DATA);
  private readonly _matDialogRef = inject(
    MatDialogRef<DialogMarkTaskDoneComponent, MarkTaskDoneDialogResult>,
  );
  private readonly _cd = inject(ChangeDetectorRef);

  selectedPlacement: SchedulePlacementType = 'ALL_DAY';
  customTime = '12:00';
  isEditingTime = false;
  selectedDurationChoice: DurationAdjustmentType = 'ADJUST_TO_TRACKED';

  @ViewChild('inlineTimeInput')
  set inlineTimeInputRef(ref: ElementRef<HTMLInputElement> | undefined) {
    if (ref) {
      setTimeout(() => {
        ref.nativeElement.focus();
        ref.nativeElement.select();
      });
    }
  }

  ngOnInit(): void {
    if (this.data.currentScheduledTime != null) {
      const d = new Date(this.data.currentScheduledTime);
      if (d.getHours() === 0 && d.getMinutes() === 0) {
        this.selectedPlacement = 'ALL_DAY';
        this.customTime = '12:00';
      } else {
        this.selectedPlacement = 'CUSTOM_TIME';
        this.customTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
    } else {
      this.selectedPlacement = 'ALL_DAY';
      const now = new Date();
      this.customTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }

    this.selectedDurationChoice = 'ADJUST_TO_TRACKED';
  }

  get timeSpentStr(): string {
    return formatDuration(this.data.timeSpent);
  }

  get timeEstimateStr(): string {
    return formatDuration(this.data.timeEstimate);
  }

  get formattedCustomTime(): string {
    return formatTime12h(this.customTime);
  }

  get hasDurationChoice(): boolean {
    return this.data.timeSpent !== this.data.timeEstimate;
  }

  get isOvertime(): boolean {
    return this.data.timeSpent > this.data.timeEstimate;
  }

  get adjustDurationLabel(): string {
    if (this.data.timeSpent === 0) {
      return 'Adjust to 15m';
    }
    if (this.isOvertime) {
      return `Expand to ${this.timeSpentStr}`;
    }
    return `Shrink to ${this.timeSpentStr}`;
  }

  get adjustDurationBadge(): string {
    return this.data.timeSpent === 0 ? 'Default' : 'Actual';
  }

  get keepDurationLabel(): string {
    if (this.data.timeEstimate > 0) {
      return `Keep ${this.timeEstimateStr}`;
    }
    return 'Keep 15m';
  }

  get placementClue(): string {
    if (this.selectedPlacement === 'ALL_DAY') {
      return 'Preserves slot at top of day timeline';
    }
    return `Places task into daily time grid at ${this.formattedCustomTime}`;
  }

  get durationClue(): string {
    if (this.selectedDurationChoice === 'KEEP_ESTIMATE') {
      return `Preserves planned time allocation on schedule (${this.timeEstimateStr} planned).`;
    }
    if (this.isOvertime) {
      return `Reflects overtime work on calendar (${this.timeSpentStr} actual).`;
    }
    if (this.data.timeSpent === 0) {
      return 'Adjusts schedule block to default duration (15m default).';
    }
    return `Frees up unused planned calendar time (${this.timeSpentStr} actual).`;
  }

  selectPlacement(type: SchedulePlacementType): void {
    this.selectedPlacement = type;
    this.isEditingTime = false;
    this._cd.markForCheck();
  }

  onCustomTimeClick(): void {
    if (this.selectedPlacement !== 'CUSTOM_TIME') {
      this.selectedPlacement = 'CUSTOM_TIME';
      this.isEditingTime = false;
    } else {
      this.isEditingTime = true;
    }
    this._cd.markForCheck();
  }

  selectDurationChoice(type: DurationAdjustmentType): void {
    this.selectedDurationChoice = type;
    this._cd.markForCheck();
  }

  onPlacementPillKeydown(event: KeyboardEvent, current: SchedulePlacementType): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const next: SchedulePlacementType =
        current === 'ALL_DAY' ? 'CUSTOM_TIME' : 'ALL_DAY';
      this.selectPlacement(next);
    }
  }

  onDurationPillKeydown(event: KeyboardEvent, current: DurationAdjustmentType): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const next: DurationAdjustmentType =
        current === 'ADJUST_TO_TRACKED' ? 'KEEP_ESTIMATE' : 'ADJUST_TO_TRACKED';
      this.selectDurationChoice(next);
    }
  }

  onInlineTimeKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const inputVal = (event.target as HTMLInputElement).value;
      this._commitInlineTime(inputVal);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.isEditingTime = false;
      this._cd.markForCheck();
    }
  }

  onInlineTimeBlur(event: FocusEvent): void {
    const inputVal = (event.target as HTMLInputElement)?.value;
    this._commitInlineTime(inputVal);
  }

  private _commitInlineTime(rawVal: string): void {
    this.customTime = parseCustomTimeString(rawVal, this.customTime);
    this.isEditingTime = false;
    this._cd.markForCheck();
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (this.isEditingTime) {
      return;
    }
    if (event.key === 'Enter') {
      const target = event.target as HTMLElement;
      if (target && target.closest('.cancel-btn')) {
        return;
      }
      event.preventDefault();
      this.submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
    }
  }

  cancel(): void {
    this._matDialogRef.close();
  }

  submit(): void {
    const baseDate = this.data.currentScheduledTime
      ? new Date(this.data.currentScheduledTime)
      : this.data.dueDay
        ? new Date(`${this.data.dueDay}T00:00:00`)
        : new Date();

    let dueWithTime: number;
    if (this.selectedPlacement === 'ALL_DAY') {
      const d = new Date(baseDate);
      d.setHours(0, 0, 0, 0);
      dueWithTime = d.getTime();
    } else {
      dueWithTime = getDateTimeFromClockString(this.customTime, baseDate);
    }

    let durationAdjustment: DurationAdjustmentResult | undefined;
    if (this.hasDurationChoice) {
      let newEstimateDurationMs: number;
      if (this.selectedDurationChoice === 'KEEP_ESTIMATE') {
        newEstimateDurationMs =
          this.data.timeEstimate > 0
            ? this.data.timeEstimate
            : TASK_DONE_DEFAULT_MIN_DURATION_MS;
      } else {
        newEstimateDurationMs =
          this.data.timeSpent > 0
            ? this.data.timeSpent
            : TASK_DONE_DEFAULT_MIN_DURATION_MS;
      }
      durationAdjustment = {
        type: this.selectedDurationChoice,
        newEstimateDurationMs,
      };
    }

    const result: MarkTaskDoneDialogResult = {
      confirmed: true,
      placement: {
        type: this.selectedPlacement,
        dueWithTime,
      },
      durationAdjustment,
    };

    this._matDialogRef.close(result);
  }
}
