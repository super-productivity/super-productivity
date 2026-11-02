import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { DialogSimpleCounterEditComponent } from './dialog-simple-counter-edit.component';
import { SimpleCounterService } from '../simple-counter.service';
import { DateService } from '../../../core/date/date.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { ShareService } from '../../../core/share/share.service';
import { SnackService } from '../../../core/snack/snack.service';
import { EMPTY_SIMPLE_COUNTER } from '../simple-counter.const';
import { SimpleCounterType } from '../simple-counter.model';

describe('DialogSimpleCounterEditComponent stopwatch seconds (#10577)', () => {
  it('keeps the seconds of a typed duration', async () => {
    const counterService = jasmine.createSpyObj<SimpleCounterService>(
      'SimpleCounterService',
      ['setCounterForDate', 'updateSimpleCounter'],
    );
    await TestBed.configureTestingModule({
      imports: [
        DialogSimpleCounterEditComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        {
          provide: MatDialogRef,
          useValue: jasmine.createSpyObj('MatDialogRef', ['close']),
        },
        { provide: MatDialog, useValue: {} },
        { provide: SimpleCounterService, useValue: counterService },
        { provide: DateService, useValue: { todayStr: () => '2026-10-12' } },
        { provide: DateTimeFormatService, useValue: { currentLocale: () => 'en-US' } },
        { provide: ShareService, useValue: {} },
        { provide: SnackService, useValue: {} },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            simpleCounter: {
              ...EMPTY_SIMPLE_COUNTER,
              id: 'lap',
              type: SimpleCounterType.StopWatch,
              isTrackStreaks: false,
              countOnDay: {},
            },
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DialogSimpleCounterEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const input: HTMLInputElement =
      fixture.nativeElement.querySelector('input[name="count"]');
    input.value = '33m05s';
    input.dispatchEvent(new Event('input'));
    fixture.componentInstance.save();

    // 33m 5s
    expect(counterService.setCounterForDate).toHaveBeenCalledWith(
      'lap',
      '2026-10-12',
      1985000,
    );
  });
});
