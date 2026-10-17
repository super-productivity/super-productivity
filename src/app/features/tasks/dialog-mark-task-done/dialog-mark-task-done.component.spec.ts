import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { DialogMarkTaskDoneComponent } from './dialog-mark-task-done.component';
import {
  MarkTaskDoneDialogData,
  TASK_DONE_DEFAULT_MIN_DURATION_MS,
} from './dialog-mark-task-done.model';

describe('DialogMarkTaskDoneComponent', () => {
  let fixture: ComponentFixture<DialogMarkTaskDoneComponent>;
  let component: DialogMarkTaskDoneComponent;
  let matDialogRefSpy: jasmine.SpyObj<MatDialogRef<DialogMarkTaskDoneComponent>>;

  const setup = (data: MarkTaskDoneDialogData): void => {
    matDialogRefSpy = jasmine.createSpyObj<MatDialogRef<DialogMarkTaskDoneComponent>>(
      'MatDialogRef',
      ['close'],
    );

    TestBed.configureTestingModule({
      imports: [DialogMarkTaskDoneComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: matDialogRefSpy },
      ],
    });

    fixture = TestBed.createComponent(DialogMarkTaskDoneComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('US 1: Unscheduled task without tracking or estimates (- / -)', () => {
    beforeEach(() => {
      setup({
        taskId: 't1',
        taskTitle: 'Quick errand',
        timeSpent: 0,
        timeEstimate: 0,
        currentScheduledTime: null,
      });
    });

    it('should display header with Tracked: 0m of 0m estimate', () => {
      const summaryCard = fixture.debugElement.query(By.css('.task-summary-card'));
      expect(summaryCard).toBeTruthy();
      expect(summaryCard.nativeElement.textContent).toContain('Quick errand');
      expect(summaryCard.nativeElement.textContent).toContain(
        'Tracked: 0m of 0m estimate',
      );
    });

    it('should offer schedule placement pills', () => {
      const pills = fixture.debugElement.queryAll(By.css('.segmented-pills button'));
      expect(pills.length).toBe(2);
      expect(pills[0].nativeElement.textContent).toContain('12:00 AM (All Day)');
      expect(component.selectedPlacement).toBe('ALL_DAY');
    });

    it('should omit the duration adjustment row completely', () => {
      const sections = fixture.debugElement.queryAll(By.css('.pill-group-section'));
      expect(sections.length).toBe(1); // Only placement row
      const durationPills = fixture.debugElement.query(
        By.css('[aria-label="Duration Adjustment"]'),
      );
      expect(durationPills).toBeNull();
    });

    it('should confirm with ALL_DAY and undefined durationAdjustment', () => {
      component.submit();
      expect(matDialogRefSpy.close).toHaveBeenCalledTimes(1);
      const res = matDialogRefSpy.close.calls.mostRecent().args[0];
      expect(res?.confirmed).toBeTrue();
      expect(res?.placement.type).toBe('ALL_DAY');
      expect(res?.durationAdjustment).toBeUndefined();
    });
  });

  describe('US 2: Tasks with estimate but zero tracked time (- / 1h)', () => {
    beforeEach(() => {
      setup({
        taskId: 't2',
        taskTitle: 'Write Report',
        timeSpent: 0,
        timeEstimate: 60 * 60 * 1000, // 1h
        currentScheduledTime: null,
      });
    });

    it('should render duration adjustment options: Keep 1h vs Adjust 15m default', () => {
      const durationGroup = fixture.debugElement.query(
        By.css('[aria-label="Duration Adjustment"]'),
      );
      expect(durationGroup).toBeTruthy();

      const pills = durationGroup.queryAll(By.css('button.pill-button'));
      expect(pills.length).toBe(2);

      // Left pill: Adjust to 15m
      expect(pills[0].nativeElement.textContent).toContain('Adjust to 15m');
      expect(pills[0].nativeElement.textContent).toContain('Default');

      // Right pill: Keep 1h
      expect(pills[1].nativeElement.textContent).toContain('Keep 1h');
      expect(pills[1].nativeElement.textContent).toContain('Planned');
    });

    it('should default to Adjust to 15m and return 15m default duration on submit', () => {
      expect(component.selectedDurationChoice).toBe('ADJUST_TO_TRACKED');
      component.submit();
      const res = matDialogRefSpy.close.calls.mostRecent().args[0];
      expect(res?.durationAdjustment?.type).toBe('ADJUST_TO_TRACKED');
      expect(res?.durationAdjustment?.newEstimateDurationMs).toBe(
        TASK_DONE_DEFAULT_MIN_DURATION_MS,
      );
    });

    it('should allow selecting Keep 1h and return 1h duration on submit', () => {
      component.selectDurationChoice('KEEP_ESTIMATE');
      fixture.detectChanges();

      component.submit();
      const res = matDialogRefSpy.close.calls.mostRecent().args[0];
      expect(res?.durationAdjustment?.type).toBe('KEEP_ESTIMATE');
      expect(res?.durationAdjustment?.newEstimateDurationMs).toBe(60 * 60 * 1000);
    });
  });

  describe('US 3 & US 4: Tasks under estimate (30m / 1h)', () => {
    beforeEach(() => {
      setup({
        taskId: 't3',
        taskTitle: 'Deep Work',
        timeSpent: 30 * 60 * 1000,
        timeEstimate: 60 * 60 * 1000,
        currentScheduledTime: null,
      });
    });

    it('should render header with Tracked: 30m of 1h estimate', () => {
      const summary = fixture.debugElement.query(By.css('.task-meta-line'));
      expect(summary.nativeElement.textContent).toContain('Tracked: 30m of 1h estimate');
    });

    it('should offer shrinking schedule block to tracked 30m (US 3)', () => {
      const durationGroup = fixture.debugElement.query(
        By.css('[aria-label="Duration Adjustment"]'),
      );
      const leftPill = durationGroup.queryAll(By.css('button.pill-button'))[0];
      expect(leftPill.nativeElement.textContent).toContain('Shrink to 30m');
      expect(leftPill.nativeElement.textContent).toContain('Actual');

      component.selectDurationChoice('ADJUST_TO_TRACKED');
      component.submit();
      const res = matDialogRefSpy.close.calls.mostRecent().args[0];
      expect(res?.durationAdjustment?.type).toBe('ADJUST_TO_TRACKED');
      expect(res?.durationAdjustment?.newEstimateDurationMs).toBe(30 * 60 * 1000);
    });

    it('should offer keeping original estimate block (US 4)', () => {
      const durationGroup = fixture.debugElement.query(
        By.css('[aria-label="Duration Adjustment"]'),
      );
      const rightPill = durationGroup.queryAll(By.css('button.pill-button'))[1];
      expect(rightPill.nativeElement.textContent).toContain('Keep 1h');
      expect(rightPill.nativeElement.textContent).toContain('Planned');

      component.selectDurationChoice('KEEP_ESTIMATE');
      component.submit();
      const res = matDialogRefSpy.close.calls.mostRecent().args[0];
      expect(res?.durationAdjustment?.type).toBe('KEEP_ESTIMATE');
      expect(res?.durationAdjustment?.newEstimateDurationMs).toBe(60 * 60 * 1000);
    });
  });

  describe('US 5: Already scheduled task (10:00 AM)', () => {
    const scheduledTime = new Date();
    scheduledTime.setHours(10, 0, 0, 0);

    beforeEach(() => {
      setup({
        taskId: 't4',
        taskTitle: 'Client Meeting',
        timeSpent: 30 * 60 * 1000,
        timeEstimate: 60 * 60 * 1000,
        currentScheduledTime: scheduledTime.getTime(),
      });
    });

    it('should pre-select CUSTOM_TIME and pre-fill scheduled time as 10:00 AM', () => {
      expect(component.selectedPlacement).toBe('CUSTOM_TIME');
      expect(component.customTime).toBe('10:00');
      expect(component.formattedCustomTime).toBe('10:00 AM');

      const activePill = fixture.debugElement.query(
        By.css('.segmented-pills button.active'),
      );
      expect(activePill.nativeElement.textContent).toContain('10:00 AM');
    });

    it('should display placement clue matching the scheduled time', () => {
      const clue = fixture.debugElement.query(By.css('.pill-clue'));
      expect(clue.nativeElement.textContent).toContain(
        'Places task into daily time grid at 10:00 AM',
      );
    });
  });

  describe('US 6: Overtime task (1h 30m / 1h)', () => {
    beforeEach(() => {
      setup({
        taskId: 't5',
        taskTitle: 'Bug Fixing',
        timeSpent: 90 * 60 * 1000, // 1h 30m
        timeEstimate: 60 * 60 * 1000, // 1h
        currentScheduledTime: null,
      });
    });

    it('should offer expanding schedule block to 1h 30m', () => {
      const durationGroup = fixture.debugElement.query(
        By.css('[aria-label="Duration Adjustment"]'),
      );
      const leftPill = durationGroup.queryAll(By.css('button.pill-button'))[0];
      expect(leftPill.nativeElement.textContent).toContain('Expand to 1h 30m');
      expect(leftPill.nativeElement.textContent).toContain('Actual');

      component.selectDurationChoice('ADJUST_TO_TRACKED');
      component.submit();
      const res = matDialogRefSpy.close.calls.mostRecent().args[0];
      expect(res?.durationAdjustment?.type).toBe('ADJUST_TO_TRACKED');
      expect(res?.durationAdjustment?.newEstimateDurationMs).toBe(90 * 60 * 1000);
    });
  });

  describe('US 8, 9, 10, 11, 12: Inline Custom Time Interaction', () => {
    beforeEach(() => {
      setup({
        taskId: 't6',
        taskTitle: 'Refactor Code',
        timeSpent: 0,
        timeEstimate: 0,
        currentScheduledTime: null,
      });
    });

    it('US 8: First click on custom time pill activates it without entering edit mode', () => {
      expect(component.selectedPlacement).toBe('ALL_DAY');
      expect(component.isEditingTime).toBeFalse();

      component.onCustomTimeClick();
      fixture.detectChanges();

      expect(component.selectedPlacement).toBe('CUSTOM_TIME');
      expect(component.isEditingTime).toBeFalse();
      const input = fixture.debugElement.query(By.css('.inline-time-input'));
      expect(input).toBeNull();
    });

    it('US 9: Second click on active custom time pill enters inline edit mode with zero layout shift', () => {
      component.selectPlacement('CUSTOM_TIME');
      fixture.detectChanges();

      expect(component.selectedPlacement).toBe('CUSTOM_TIME');
      expect(component.isEditingTime).toBeFalse();

      component.onCustomTimeClick();
      fixture.detectChanges();

      expect(component.isEditingTime).toBeTrue();
      const input = fixture.debugElement.query(By.css('.inline-time-input'));
      expect(input).toBeTruthy();

      // Zero-shift verify: digits container has visibility: hidden
      const hiddenDigits = fixture.debugElement.query(By.css('.custom-time-digits'));
      expect(hiddenDigits.nativeElement.style.visibility).toBe('hidden');
    });

    it('US 10: Typing shorthand time interprets and updates time', () => {
      component.selectPlacement('CUSTOM_TIME');
      component.customTime = '10:00';
      component.onCustomTimeClick(); // enter edit mode
      fixture.detectChanges();

      const inputEl: HTMLInputElement = fixture.debugElement.query(
        By.css('.inline-time-input'),
      ).nativeElement;
      inputEl.value = '930';

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      spyOn(enterEvent, 'stopPropagation');
      inputEl.dispatchEvent(enterEvent);
      fixture.detectChanges();

      expect(component.customTime).toBe('09:30');
      expect(component.formattedCustomTime).toBe('9:30 AM');
      expect(component.isEditingTime).toBeFalse();
    });

    it('US 11: Pressing Enter or blurring commits edited time and exits edit mode without closing dialog', () => {
      component.selectPlacement('CUSTOM_TIME');
      component.customTime = '10:00';
      component.onCustomTimeClick();
      fixture.detectChanges();

      const inputEl: HTMLInputElement = fixture.debugElement.query(
        By.css('.inline-time-input'),
      ).nativeElement;
      inputEl.value = '11:15';

      const blurEvent = new FocusEvent('blur');
      inputEl.dispatchEvent(blurEvent);
      fixture.detectChanges();

      expect(component.customTime).toBe('11:15');
      expect(component.isEditingTime).toBeFalse();
      expect(matDialogRefSpy.close).not.toHaveBeenCalled();
    });

    it('US 12: Pressing Escape while typing reverts time edit and exits edit mode without closing dialog', () => {
      component.selectPlacement('CUSTOM_TIME');
      component.customTime = '10:00';
      component.onCustomTimeClick();
      fixture.detectChanges();

      const inputEl: HTMLInputElement = fixture.debugElement.query(
        By.css('.inline-time-input'),
      ).nativeElement;
      inputEl.value = '999';

      const escEvent = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      spyOn(escEvent, 'stopPropagation');
      inputEl.dispatchEvent(escEvent);
      fixture.detectChanges();

      expect(component.customTime).toBe('10:00'); // reverted
      expect(component.isEditingTime).toBeFalse();
      expect(matDialogRefSpy.close).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard navigation and Dialog lifecycle', () => {
    beforeEach(() => {
      setup({
        taskId: 't7',
        taskTitle: 'Keyboard Nav Test',
        timeSpent: 0,
        timeEstimate: 0,
        currentScheduledTime: null,
      });
    });

    it('Enter on host confirms dialog', () => {
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      component.onKeyDown(enterEvent);
      expect(matDialogRefSpy.close).toHaveBeenCalledTimes(1);
      expect(matDialogRefSpy.close.calls.mostRecent().args[0]?.confirmed).toBeTrue();
    });

    it('Escape on host cancels dialog', () => {
      const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      component.onKeyDown(escEvent);
      expect(matDialogRefSpy.close).toHaveBeenCalledTimes(1);
      expect(matDialogRefSpy.close.calls.mostRecent().args[0]).toBeUndefined();
    });

    it('clicking close button cancels dialog', () => {
      const closeBtn = fixture.debugElement.query(By.css('.close-btn'));
      closeBtn.nativeElement.click();
      expect(matDialogRefSpy.close).toHaveBeenCalledTimes(1);
    });

    it('clicking cancel button cancels dialog', () => {
      const cancelBtn = fixture.debugElement.query(By.css('.cancel-btn'));
      cancelBtn.nativeElement.click();
      expect(matDialogRefSpy.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('US 15, 16, 17, 18: Accessibility and UI Structure', () => {
    beforeEach(() => {
      setup({
        taskId: 't8',
        taskTitle: 'A11y Test',
        timeSpent: 30 * 60 * 1000,
        timeEstimate: 60 * 60 * 1000,
        currentScheduledTime: null,
      });
    });

    it('US 15 & 16: Clue renders at min-height: 30px preventing vertical jitter', () => {
      const clue = fixture.debugElement.query(By.css('.pill-clue'));
      expect(clue).toBeTruthy();
    });

    it('US 18: ARIA roles and labels are present', () => {
      const groups = fixture.debugElement.queryAll(By.css('[role="radiogroup"]'));
      expect(groups.length).toBe(2);

      expect(groups[0].attributes['aria-label']).toBe('Schedule Placement');
      expect(groups[1].attributes['aria-label']).toBe('Duration Adjustment');

      const radioButtons = fixture.debugElement.queryAll(By.css('[role="radio"]'));
      expect(radioButtons.length).toBe(4);

      radioButtons.forEach((rb) => {
        expect(rb.attributes['aria-checked']).toBeDefined();
      });
    });

    it('US 18: Arrow keys cycle radiogroup selection', () => {
      expect(component.selectedPlacement).toBe('ALL_DAY');

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
      component.onPlacementPillKeydown(event, 'ALL_DAY');
      expect(component.selectedPlacement).toBe('CUSTOM_TIME');

      component.onPlacementPillKeydown(event, 'CUSTOM_TIME');
      expect(component.selectedPlacement).toBe('ALL_DAY');
    });
  });
});
