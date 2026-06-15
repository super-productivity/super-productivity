import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
  RepeatFreqOption,
  RepeatFreqPickerComponent,
} from './repeat-freq-picker.component';

// Unit coverage for the picker's branching logic (preset ordering, More toggle,
// Custom handling) and the listbox keyboard navigation — previously exercised
// only indirectly through the dialog spec.
describe('RepeatFreqPickerComponent', () => {
  const OPTS: RepeatFreqOption[] = [
    { value: 'DAILY', label: 'Every day' },
    { value: 'WEEKLY_CURRENT_WEEKDAY', label: 'Weekly Mon' },
    { value: 'MONTHLY_CURRENT_DATE', label: 'Monthly 15' },
    { value: 'WEEKENDS', label: 'Weekends' }, // tail (not common)
    { value: 'QUARTERLY_CURRENT_DATE', label: 'Quarterly' }, // tail
    { value: 'RRULE', label: 'Custom' },
  ];
  const COMMON = ['DAILY', 'WEEKLY_CURRENT_WEEKDAY', 'MONTHLY_CURRENT_DATE'];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RepeatFreqPickerComponent, TranslateModule.forRoot()],
    });
  });

  const make = (
    value?: string,
    opts: RepeatFreqOption[] = OPTS,
    common: readonly string[] = COMMON,
  ): RepeatFreqPickerComponent => {
    const fixture = TestBed.createComponent(RepeatFreqPickerComponent);
    fixture.componentRef.setInput('options', opts);
    fixture.componentRef.setInput('commonValues', common);
    if (value !== undefined) {
      fixture.componentRef.setInput('value', value);
    }
    return fixture.componentInstance;
  };

  it('shows the common presets first and hides the tail until expanded', () => {
    const c = make('DAILY');
    expect(c.presets().map((o) => o.value)).toEqual(COMMON);
    expect(c.canToggle()).toBe(true);
    c.toggleExpanded();
    expect(c.presets().map((o) => o.value)).toEqual([
      ...COMMON,
      'WEEKENDS',
      'QUARTERLY_CURRENT_DATE',
    ]);
  });

  it('appends the active tail preset while collapsed so the selection always shows', () => {
    const c = make('WEEKENDS');
    expect(c.presets().map((o) => o.value)).toEqual([...COMMON, 'WEEKENDS']);
  });

  it('exposes Custom separately and resolves the selected label', () => {
    const c = make('RRULE');
    expect(c.customOption()?.value).toBe('RRULE');
    expect(c.selectedLabel()).toBe('Custom');
  });

  it('canToggle() is false when there is no hidden tail', () => {
    const c = make(
      undefined,
      [
        { value: 'DAILY', label: 'd' },
        { value: 'RRULE', label: 'c' },
      ],
      ['DAILY'],
    );
    expect(c.canToggle()).toBe(false);
  });

  it('select() emits and closes; toggleExpanded() keeps the panel open', () => {
    const c = make('DAILY');
    const emitted: string[] = [];
    c.selected.subscribe((v) => emitted.push(v));
    c.open(document.createElement('div'));
    expect(c.isOpen()).toBe(true);
    c.toggleExpanded();
    expect(c.isOpen()).toBe(true); // long-tail expand must NOT close the panel
    expect(c.isExpanded()).toBe(true);
    c.select('WEEKENDS');
    expect(emitted).toEqual(['WEEKENDS']);
    expect(c.isOpen()).toBe(false); // selecting a value closes
  });

  it('focusableKeys() = visible options then the More toggle', () => {
    const c = make('DAILY');
    expect(c.focusableKeys()).toEqual([...COMMON, 'RRULE', c.MORE_KEY]);
  });

  it('roving focus: opens on the selection and arrow/Home/End move it', () => {
    const c = make('DAILY');
    c.open(document.createElement('div'));
    const keys = c.focusableKeys();
    expect(c.isFocusable('DAILY')).toBe(true);
    c.onPanelKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(c.isFocusable(keys[1])).toBe(true);
    c.onPanelKeydown(new KeyboardEvent('keydown', { key: 'End' }));
    expect(c.isFocusable(keys[keys.length - 1])).toBe(true);
    c.onPanelKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(c.isFocusable(keys[0])).toBe(true); // wraps to the top
    c.onPanelKeydown(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(c.isFocusable(keys[0])).toBe(true);
  });
});
