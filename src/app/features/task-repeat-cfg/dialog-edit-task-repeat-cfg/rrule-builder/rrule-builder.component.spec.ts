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
    expect(component.model().nthDays).toEqual([{ pos: 2, days: ['TU'] }]);
  });

  it('adds a second nth-weekday row and emits combined BYDAY (3MO,4SU)', async () => {
    await setup('FREQ=MONTHLY;BYDAY=3MO');
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.addNthDay(); // new row defaults to the first unused ordinal, no weekdays yet
    component.setNthDayPos(1, '4');
    component.toggleNthDayWeekday(1, 'SU');
    expect(emitted[emitted.length - 1]).toBe('FREQ=MONTHLY;BYDAY=3MO,4SU');
    component.removeNthDay(1);
    expect(emitted[emitted.length - 1]).toBe('FREQ=MONTHLY;BYDAY=3MO');
  });

  it('selects multiple weekdays on one ordinal row (first Mon + first Tue → 1MO,1TU)', async () => {
    await setup('FREQ=MONTHLY;BYDAY=1MO');
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.toggleNthDayWeekday(0, 'TU');
    expect(component.model().nthDays).toEqual([{ pos: 1, days: ['MO', 'TU'] }]);
    expect(emitted[emitted.length - 1]).toBe('FREQ=MONTHLY;BYDAY=1MO,1TU');
    // toggling it off again removes just that weekday
    component.toggleNthDayWeekday(0, 'MO');
    expect(emitted[emitted.length - 1]).toBe('FREQ=MONTHLY;BYDAY=1TU');
  });

  it('switching a row to a custom ordinal keeps the pos and shows the input', async () => {
    await setup('FREQ=MONTHLY;BYDAY=3MO');
    expect(component.isNthRowCustom(0)).toBe(false);
    component.setNthDayPos(0, component.ORD_CUSTOM);
    expect(component.isNthRowCustom(0)).toBe(true);
    // pos unchanged until the user types a number
    expect(component.model().nthDays).toEqual([{ pos: 3, days: ['MO'] }]);
    // switching back to a predefined ordinal clears the custom state
    component.setNthDayPos(0, '2');
    expect(component.isNthRowCustom(0)).toBe(false);
    expect(component.model().nthDays).toEqual([{ pos: 2, days: ['MO'] }]);
  });

  it('custom ordinal input emits any non-zero value, clamped per frequency', async () => {
    await setup('FREQ=MONTHLY;BYDAY=3MO');
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.setNthDayCustomPos(0, '-2');
    expect(emitted[emitted.length - 1]).toBe('FREQ=MONTHLY;BYDAY=-2MO');
    component.setNthDayCustomPos(0, '5');
    expect(emitted[emitted.length - 1]).toBe('FREQ=MONTHLY;BYDAY=5MO');
    // zero and garbage are ignored
    component.setNthDayCustomPos(0, '0');
    component.setNthDayCustomPos(0, 'abc');
    expect(component.model().nthDays).toEqual([{ pos: 5, days: ['MO'] }]);
    // MONTHLY clamps to ±5 — a month has at most 5 of any weekday; values past
    // that emit valid-but-dead rules (BYDAY=10MO matches nothing, ever).
    component.setNthDayCustomPos(0, '99');
    expect(component.model().nthDays).toEqual([{ pos: 5, days: ['MO'] }]);
    component.setNthDayCustomPos(0, '-99');
    expect(component.model().nthDays).toEqual([{ pos: -5, days: ['MO'] }]);
  });

  it('custom ordinal input clamps to ±53 for YEARLY', async () => {
    await setup('FREQ=YEARLY;BYMONTH=6;BYDAY=3MO');
    component.setNthDayCustomPos(0, '99');
    expect(component.model().nthDays).toEqual([{ pos: 53, days: ['MO'] }]);
  });

  it('custom ordinal input rejects a pos another row already anchors', async () => {
    // Two rows resolving to the same ordinal collapse into one on reload —
    // BYDAY cannot represent them separately.
    await setup('FREQ=MONTHLY;BYDAY=2MO,4SU');
    component.setNthDayCustomPos(1, '2');
    expect(component.model().nthDays).toEqual([
      { pos: 2, days: ['MO'] },
      { pos: 4, days: ['SU'] },
    ]);
  });

  it('a parsed ordinal outside the dropdown set renders as custom', async () => {
    await setup('FREQ=MONTHLY;BYDAY=-2MO');
    expect(component.model().monthlyMode).toBe('NTH_WEEKDAY');
    expect(component.model().nthDays).toEqual([{ pos: -2, days: ['MO'] }]);
    expect(component.isNthRowCustom(0)).toBe(true);
  });

  it('removing a row remaps the custom flags of the rows after it', async () => {
    await setup('FREQ=MONTHLY;BYDAY=3MO');
    component.addNthDay(); // row 1
    component.toggleNthDayWeekday(1, 'SU');
    component.setNthDayPos(1, component.ORD_CUSTOM); // row 1 = custom
    expect(component.isNthRowCustom(1)).toBe(true);
    component.removeNthDay(0); // row 1 becomes row 0
    expect(component.isNthRowCustom(0)).toBe(true);
  });

  it('the ordinal dropdown for a new row omits positions already used', async () => {
    await setup('FREQ=MONTHLY;BYDAY=1MO');
    component.addNthDay(); // row 1
    // row 0 uses pos 1, so row 1's options must exclude "first" (1)…
    expect(component.availableOrdinalOpts(1).map((o) => o.value)).not.toContain(1);
    // …while row 0's own options still include its current pos.
    expect(component.availableOrdinalOpts(0).map((o) => o.value)).toContain(1);
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

    // Multi-select: Wednesday is added to the row's existing Monday (Mon-first).
    expect(component.model().nthDays).toEqual([{ pos: 3, days: ['MO', 'WE'] }]);
    expect(emitted[emitted.length - 1]).toBe('FREQ=MONTHLY;BYDAY=3MO,3WE');
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

  it('switching to YEARLY seeds BYMONTH from the start month (else the rule fires monthly)', async () => {
    await setup('', '2024-06-03'); // fresh builder, June start
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.setFreq('YEARLY');
    expect(component.model().byMonth).toEqual([6]);
    // default yearly mode = on date → must carry BYMONTH to mean "once a year"
    expect(emitted[emitted.length - 1]).toBe('FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=3');
  });

  it('switching to YEARLY keeps an existing month selection', async () => {
    await setup('FREQ=DAILY;BYMONTH=1,2');
    component.setFreq('YEARLY');
    expect(component.model().byMonth).toEqual([1, 2]);
  });

  it('leaving YEARLY drops the auto-seeded month but keeps user-picked months', async () => {
    await setup('', '2024-06-03');
    component.setFreq('YEARLY'); // seeds byMonth=[6]
    component.setFreq('MONTHLY');
    // The seed would otherwise constrain the monthly rule to June only.
    expect(component.model().byMonth).toEqual([]);

    component.setFreq('YEARLY'); // seeds [6] again
    component.toggleMonth(7); // user takes ownership → [6, 7]
    component.setFreq('WEEKLY');
    expect(component.model().byMonth).toEqual([6, 7]);
  });

  it('mode and frequency switches clear a leftover BYSETPOS', async () => {
    // A bySetPos set in WEEKDAYS mode would silently narrow a day-of-month
    // rule (BYMONTHDAY=15;BYSETPOS=2 = never fires) with no UI to clear it.
    await setup('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=2');
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.setMonthlyMode('DAY_OF_MONTH');
    expect(component.model().bySetPos).toBe('');
    expect(emitted[emitted.length - 1]).not.toContain('BYSETPOS');

    // Same on a frequency switch.
    component.setMonthlyMode('WEEKDAYS');
    component.toggleSetPos(2);
    expect(component.model().bySetPos).toBe('2');
    component.setFreq('YEARLY');
    expect(component.model().bySetPos).toBe('');
  });

  it('a predefined set-position toggle closes the explicitly opened custom input', async () => {
    await setup('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR');
    component.toggleSetPosCustomMode(); // open custom input (empty value)
    expect(component.isSetPosCustom()).toBe(true);
    component.toggleSetPos(1);
    // Without this, the custom input and the 'first' toggle would both render
    // active with contradictory state.
    expect(component.isSetPosCustom()).toBe(false);
    expect(component.isSetPosActive(1)).toBe(true);
  });

  it('builds "last weekday of month" (weekday-set mode + set-position toggle)', async () => {
    await setup('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR');
    expect(component.model().monthlyMode).toBe('WEEKDAYS');
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.toggleSetPos(-1);
    expect(emitted[emitted.length - 1]).toBe(
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
    );
  });

  it('set-position toggles multi-select (first + last) and toggle off again', async () => {
    await setup('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1');
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.toggleSetPos(1); // add "first" → kept in dropdown order (1,-1)
    expect(emitted[emitted.length - 1]).toBe(
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1,-1',
    );
    expect(component.isSetPosActive(1)).toBe(true);
    expect(component.isSetPosActive(-1)).toBe(true);
    component.toggleSetPos(-1); // toggle "last" off
    expect(emitted[emitted.length - 1]).toBe(
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1',
    );
  });

  it('"Every" clears all set positions and the custom mode', async () => {
    await setup('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1,-1');
    expect(component.isSetPosEvery()).toBe(false);
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.clearSetPos();
    expect(component.isSetPosEvery()).toBe(true);
    expect(emitted[emitted.length - 1]).toBe('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR');
  });

  it('custom "which occurrence" input emits arbitrary BYSETPOS lists', async () => {
    await setup('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR');
    const emitted: string[] = [];
    component.rruleChange.subscribe((r) => emitted.push(r));
    component.setCustomBySetPos('2,-1');
    expect(emitted[emitted.length - 1]).toBe(
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=2,-1',
    );
    // invalid tokens and zeros are dropped, values clamped to ±366
    component.setCustomBySetPos('abc, 0, 5, -999');
    expect(component.model().bySetPos).toBe('5,-366');
  });

  it('a parsed BYSETPOS with no predefined toggle renders as custom', async () => {
    await setup('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=5');
    expect(component.model().monthlyMode).toBe('WEEKDAYS');
    expect(component.model().bySetPos).toBe('5');
    expect(component.isSetPosCustom()).toBe(true);
    // editing down to a toggle-representable list leaves custom mode (the
    // input was only open implicitly) and lights up the matching toggles
    component.setCustomBySetPos('2,-1');
    expect(component.isSetPosCustom()).toBe(false);
    expect(component.isSetPosActive(2)).toBe(true);
    expect(component.isSetPosActive(-1)).toBe(true);
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
