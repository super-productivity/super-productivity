import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { FormlyDateBtnComponent } from './formly-date-btn.component';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { DialogScheduleTaskComponent } from '../../features/planner/dialog-schedule-task/dialog-schedule-task.component';

describe('FormlyDateBtnComponent', () => {
  let component: FormlyDateBtnComponent;
  let fixture: ComponentFixture<FormlyDateBtnComponent>;
  let formControl: FormControl<string | null>;
  let dialogOpenSpy: jasmine.Spy;

  const setup = async (initialValue: string | null = null): Promise<void> => {
    dialogOpenSpy = jasmine.createSpy('open').and.returnValue({
      afterClosed: () => of({ date: new Date(2026, 2, 18) }),
    });

    await TestBed.configureTestingModule({
      imports: [
        FormlyDateBtnComponent,
        ReactiveFormsModule,
        FormlyModule.forRoot(),
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialog, useValue: { open: dialogOpenSpy } },
        { provide: DateTimeFormatService, useValue: { currentLocale: () => 'en-US' } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormlyDateBtnComponent);
    component = fixture.componentInstance;
    formControl = new FormControl<string | null>(initialValue);
    Object.defineProperty(component, 'formControl', {
      get: () => formControl,
      configurable: true,
    });
    component.field = {
      key: 'customStart',
      type: 'date-btn',
      props: {
        label: 'Start',
        minDateKey: 'customMin',
        maxDateKey: 'customMax',
      },
      model: {
        customMin: '2026-03-10',
        customMax: '2026-03-20',
      },
    } as FormlyFieldConfig;

    fixture.detectChanges();
  };

  it('opens the schedule dialog with date-only options and writes YYYY-MM-DD', async () => {
    await setup();

    component.openDialog();

    expect(dialogOpenSpy).toHaveBeenCalledWith(DialogScheduleTaskComponent, {
      autoFocus: false,
      data: jasmine.objectContaining({
        isSelectDueOnly: true,
        showTime: false,
        showReminder: false,
        minDate: new Date(2026, 2, 10),
        maxDate: new Date(2026, 2, 20),
      }),
    });
    expect(formControl.value).toBe('2026-03-18');
    expect(formControl.dirty).toBeTrue();
    expect(formControl.touched).toBeTrue();
  });

  it('clears the selected date', async () => {
    await setup('2026-03-18');

    component.clear();

    expect(formControl.value).toBeNull();
    expect(formControl.dirty).toBeTrue();
    expect(formControl.touched).toBeTrue();
  });
});
