import { ElementRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgModel } from '@angular/forms';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';

import { DialogSelectDateTimeComponent } from './dialog-select-date-time.component';

describe('DialogSelectDateTimeComponent', () => {
  let fixture: ComponentFixture<DialogSelectDateTimeComponent>;
  let component: DialogSelectDateTimeComponent;
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<DialogSelectDateTimeComponent, number>>;

  const initialDateTime = new Date(2026, 0, 1, 8, 15);

  beforeEach(async () => {
    dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [
        DialogSelectDateTimeComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideNativeDateAdapter(),
        { provide: MatDialogRef, useValue: dialogRefSpy },
        { provide: MAT_DIALOG_DATA, useValue: { dateTime: initialDateTime.getTime() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogSelectDateTimeComponent);
    component = fixture.componentInstance;
  });

  const setInputModelValues = (selectedDate: Date, selectedTime: Date): void => {
    component.datepickerInput = {
      control: {
        value: selectedDate,
        markAsTouched: jasmine.createSpy('markAsTouched'),
      },
    } as unknown as NgModel;
    component.timepickerInput = {
      control: {
        value: selectedTime,
        markAsTouched: jasmine.createSpy('markAsTouched'),
      },
    } as unknown as NgModel;
  };

  const expectSaveAfterInputBlur = (
    inputRef: 'datepickerInputEl' | 'timepickerInputEl',
    emittedValue: Date,
    expectedDateTime: Date,
  ): void => {
    const input = document.createElement('input');
    component[inputRef] = new ElementRef(input);
    input.addEventListener('blur', () => component.onDateTimeChange(emittedValue));
    document.body.appendChild(input);

    try {
      input.focus();

      component.onSaveClick();

      expect(dialogRefSpy.close).toHaveBeenCalledOnceWith(expectedDateTime.getTime());
    } finally {
      input.remove();
    }
  };

  it('commits a focused date input value before closing on save', () => {
    const selectedDate = new Date(2026, 0, 2, 8, 15);
    const selectedTime = initialDateTime;
    const expectedDateTime = new Date(2026, 0, 2, 8, 15);

    setInputModelValues(selectedDate, selectedTime);

    expectSaveAfterInputBlur('datepickerInputEl', selectedDate, expectedDateTime);
  });

  it('commits a focused time input value before closing on save', () => {
    const selectedDate = new Date(2026, 0, 2, 8, 15);
    const selectedTime = new Date(2026, 0, 1, 10, 45);
    const expectedDateTime = new Date(2026, 0, 2, 10, 45);

    setInputModelValues(selectedDate, selectedTime);

    expectSaveAfterInputBlur('timepickerInputEl', selectedTime, expectedDateTime);
  });
});
