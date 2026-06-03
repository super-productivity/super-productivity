import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RruleBuilderComponent } from './rrule-builder.component';

describe('RruleBuilderComponent', () => {
  let fixture: ComponentFixture<RruleBuilderComponent>;
  let component: RruleBuilderComponent;

  const setup = async (
    rrule = '',
    startDate = '2024-06-03',
    repeatFromCompletion = false,
  ): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [RruleBuilderComponent, TranslateModule.forRoot(), NoopAnimationsModule],
    }).compileComponents();
    fixture = TestBed.createComponent(RruleBuilderComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('rrule', rrule);
    fixture.componentRef.setInput('startDate', startDate);
    fixture.componentRef.setInput('repeatFromCompletion', repeatFromCompletion);
    fixture.detectChanges();
  };

  it('parses an existing rrule into the model (nth-weekday)', async () => {
    await setup('FREQ=MONTHLY;BYDAY=2TU');
    expect(component.model().freq).toBe('MONTHLY');
    expect(component.model().monthlyMode).toBe('NTH_WEEKDAY');
    expect(component.model().nthDays).toEqual([{ pos: 2, day: 'TU' }]);
  });

  it('adds a second nth-weekday row and emits combined BYDAY (3MO,4SU)', async () => {
    await setup('FREQ=MONTHLY;BYDAY=3MO');
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.addNthDay();
    component.setNthDayPos(1, '4');
    component.setNthDayWeekday(1, 'SU');
    expect(emitted[emitted.length - 1]).toBe('FREQ=MONTHLY;BYDAY=3MO,4SU');
    component.removeNthDay(1);
    expect(emitted[emitted.length - 1]).toBe('FREQ=MONTHLY;BYDAY=3MO');
  });

  it('clicking a weekday button patches the correct nth row (nested @for $index)', async () => {
    // Regression: the per-row weekday buttons live inside a nested @for whose
    // own $index (the weekday index) shadowed the outer row index, so clicking
    // anything but the first weekday targeted a wrong/non-existent row.
    await setup('FREQ=MONTHLY;BYDAY=3MO');
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));

    // The single nth-weekday row renders exactly 7 weekday toggle buttons.
    const group = Array.from(
      fixture.nativeElement.querySelectorAll('.rb-toggles') as NodeListOf<Element>,
    ).find((el) => el.querySelectorAll('button.rb-tgl').length === 7) as Element;
    const buttons = group.querySelectorAll('button.rb-tgl');
    (buttons[2] as HTMLButtonElement).click(); // Wednesday (3rd weekday)
    fixture.detectChanges();

    expect(component.model().nthDays).toEqual([{ pos: 3, day: 'WE' }]);
    expect(emitted[emitted.length - 1]).toBe('FREQ=MONTHLY;BYDAY=3WE');
  });

  it('emits an assembled rrule when a weekday is toggled', async () => {
    await setup('FREQ=WEEKLY;BYDAY=MO');
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.toggleDay('WE');
    expect(emitted[emitted.length - 1]).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
    component.toggleDay('MO'); // toggling off removes it
    expect(emitted[emitted.length - 1]).toBe('FREQ=WEEKLY;BYDAY=WE');
  });

  it('toggling a month off removes it from BYMONTH', async () => {
    await setup('FREQ=DAILY;BYMONTH=1,2');
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.toggleMonth(1);
    expect(emitted[emitted.length - 1]).toBe('FREQ=DAILY;BYMONTH=2');
  });

  it('changing frequency emits the new rule', async () => {
    await setup('FREQ=WEEKLY;BYDAY=MO');
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.setFreq('DAILY');
    expect(emitted[emitted.length - 1]).toBe('FREQ=DAILY');
  });

  it('builds "last weekday of month" (weekday-set mode + set position)', async () => {
    await setup('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR');
    expect(component.model().monthlyMode).toBe('WEEKDAYS');
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.setBySetPos('-1'); // applies even though the section is collapsed
    expect(emitted[emitted.length - 1]).toBe(
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
    );
  });

  it('custom day input accepts arbitrary values like -5', async () => {
    await setup('FREQ=MONTHLY;BYMONTHDAY=15');
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.setMonthDays('1,15,-5');
    expect(emitted[emitted.length - 1]).toBe('FREQ=MONTHLY;BYMONTHDAY=1,15,-5');
  });

  it('initializes the schedule-type toggle from the repeatFromCompletion input', async () => {
    await setup('FREQ=DAILY;INTERVAL=3', '2024-06-03', true);
    expect(component.fromCompletion()).toBe(true);
  });

  it('emits repeatFromCompletionChange when the schedule type is toggled', async () => {
    await setup('FREQ=DAILY;INTERVAL=3');
    expect(component.fromCompletion()).toBe(false);
    const emitted: boolean[] = [];
    component.repeatFromCompletionChange.subscribe((v) => emitted.push(v));
    component.setRepeatFromCompletion(true);
    expect(component.fromCompletion()).toBe(true);
    expect(emitted[emitted.length - 1]).toBe(true);
  });
});
