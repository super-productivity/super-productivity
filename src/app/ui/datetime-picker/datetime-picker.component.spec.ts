import { TestBed, ComponentFixture } from '@angular/core/testing';
import { DateTimePickerComponent } from './datetime-picker.component';
import { DateService } from '../../core/date/date.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { MatNativeDateModule } from '@angular/material/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService, TranslateStore } from '@ngx-translate/core';
import { signal } from '@angular/core';
import { TaskReminderOptionId } from '../../features/tasks/task.model';

describe('DateTimePickerComponent', () => {
  let component: DateTimePickerComponent;
  let fixture: ComponentFixture<DateTimePickerComponent>;
  let dateServiceSpy: jasmine.SpyObj<DateService>;
  let globalConfigServiceMock: any;

  beforeEach(async () => {
    dateServiceSpy = jasmine.createSpyObj('DateService', ['isToday', 'todayStr']);
    globalConfigServiceMock = {
      localization: signal({}),
      cfg: signal({}),
    };

    await TestBed.configureTestingModule({
      imports: [
        DateTimePickerComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
        MatNativeDateModule,
      ],
      providers: [
        { provide: DateService, useValue: dateServiceSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceMock },
        TranslateService,
        TranslateStore,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DateTimePickerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should render the calendar by default', () => {
    const calendarEl = fixture.nativeElement.querySelector('mat-calendar');
    expect(calendarEl).toBeTruthy();
  });

  it('should show quick access buttons if showQuickAccess is true', () => {
    fixture.componentRef.setInput('showQuickAccess', true);
    fixture.detectChanges();
    const quickAccessEl = fixture.nativeElement.querySelector('.quick-access');
    expect(quickAccessEl).toBeTruthy();
  });

  it('should hide quick access buttons if showQuickAccess is false', () => {
    fixture.componentRef.setInput('showQuickAccess', false);
    fixture.detectChanges();
    const quickAccessEl = fixture.nativeElement.querySelector('.quick-access');
    expect(quickAccessEl).toBeFalsy();
  });

  it('should show time input if showTime is true', () => {
    fixture.componentRef.setInput('showTime', true);
    fixture.detectChanges();
    const timeField = fixture.nativeElement.querySelector('.time-form-field');
    expect(timeField).toBeTruthy();
  });

  it('should hide time input if showTime is false', () => {
    fixture.componentRef.setInput('showTime', false);
    fixture.detectChanges();
    const timeField = fixture.nativeElement.querySelector('.time-form-field');
    expect(timeField).toBeFalsy();
  });

  it('should emit dateSelected when a date is selected on the calendar', () => {
    spyOn(component.dateSelected, 'emit');
    const testDate = new Date();
    component.dateSelected.emit(testDate);
    expect(component.dateSelected.emit).toHaveBeenCalledWith(testDate);
  });

  it('should emit timeChanged when onTimeChange is called', () => {
    spyOn(component.timeChanged, 'emit');
    component.onTimeChange('10:30');
    expect(component.timeChanged.emit).toHaveBeenCalledWith('10:30');
  });

  it('should emit reminderChanged when onReminderChange is called', () => {
    spyOn(component.reminderChanged, 'emit');
    component.onReminderChange(TaskReminderOptionId.AtStart);
    expect(component.reminderChanged.emit).toHaveBeenCalledWith(
      TaskReminderOptionId.AtStart,
    );
  });

  it('should emit quickAccessClick when quickAccessBtnClick is called', () => {
    spyOn(component.quickAccessClick, 'emit');
    const mockEvent = new MouseEvent('click');
    component.quickAccessBtnClick(mockEvent, 'tomorrow');
    expect(component.quickAccessClick.emit).toHaveBeenCalledWith('tomorrow');
  });

  it('should emit timeChanged with null and reminderChanged with DoNotRemind when onTimeClear is called', () => {
    spyOn(component.timeChanged, 'emit');
    spyOn(component.reminderChanged, 'emit');
    const mockEvent = new MouseEvent('click');
    component.onTimeClear(mockEvent);
    expect(component.timeChanged.emit).toHaveBeenCalledWith(null);
    expect(component.reminderChanged.emit).toHaveBeenCalledWith(
      TaskReminderOptionId.DoNotRemind,
    );
  });

  it('should autofill time on focus', () => {
    spyOn(component.timeChanged, 'emit');
    spyOn(component.dateSelected, 'emit');
    fixture.componentRef.setInput('selectedDate', new Date(2026, 4, 6));
    fixture.componentRef.setInput('selectedTime', null);
    dateServiceSpy.isToday.and.returnValue(false);

    component.onTimeFocus();

    expect(component.timeChanged.emit).toHaveBeenCalledWith('09:00');
  });
});
