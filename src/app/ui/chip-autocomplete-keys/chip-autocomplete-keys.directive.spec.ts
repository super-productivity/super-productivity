import { Component, computed } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, UntypedFormControl } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DOWN_ARROW, ENTER, TAB } from '@angular/cdk/keycodes';
import { MatAutocomplete, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatChipGrid, MatChipInput } from '@angular/material/chips';
import { MatOption } from '@angular/material/core';
import { ChipAutocompleteKeysDirective } from './chip-autocomplete-keys.directive';

const SUGGESTIONS = [
  { id: 'A', title: 'Apple' },
  { id: 'B', title: 'Banana' },
  { id: 'D', title: 'Blueberry' },
  { id: 'C', title: 'Cherry' },
];

@Component({
  template: `
    <mat-chip-grid #grid>
      <input
        [formControl]="ctrl"
        [matAutocomplete]="auto"
        [matChipInputFor]="grid"
        [matChipInputAddOnBlur]="true"
        spChipAutocompleteKeys
        (suggestionAccepted)="accepted.push($event)"
        (textCommitted)="committed.push($event)"
      />
    </mat-chip-grid>
    <mat-autocomplete #auto="matAutocomplete">
      @for (s of filtered(); track s.id) {
        <mat-option [value]="s.id">{{ s.title }}</mat-option>
      }
    </mat-autocomplete>
  `,
  imports: [
    ReactiveFormsModule,
    MatChipGrid,
    MatChipInput,
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatOption,
    ChipAutocompleteKeysDirective,
  ],
  standalone: true,
})
class HostComponent {
  ctrl = new UntypedFormControl();
  accepted: string[] = [];
  committed: string[] = [];
  private readonly _val = toSignal(this.ctrl.valueChanges, { initialValue: '' });
  filtered = computed(() => {
    const v = (this._val() || '').toLowerCase();
    return SUGGESTIONS.filter((s) => s.title.toLowerCase().startsWith(v));
  });
}

describe('ChipAutocompleteKeysDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const getInput = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('input') as HTMLInputElement;

  const getAutocomplete = (): MatAutocomplete =>
    fixture.debugElement.query((d) => d.name === 'mat-autocomplete').componentInstance;

  const pressKey = (
    key: string,
    keyCode: number,
    init: KeyboardEventInit = {},
  ): boolean =>
    getInput().dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
        keyCode,
        ...init,
      }),
    );

  const typeAndOpen = async (text: string): Promise<void> => {
    const input = getInput();
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, NoopAnimationsModule],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('Tab accepts the first suggestion and keeps focus in the input', async () => {
    await typeAndOpen('ban');
    expect(getAutocomplete().isOpen).toBeTrue();

    const notPrevented = pressKey('Tab', TAB);

    expect(host.accepted).toEqual(['B']);
    expect(host.committed).toEqual([]);
    expect(notPrevented).toBeFalse();
    expect(getInput().value).toBe('');
    expect(host.ctrl.value).toBeNull();
    expect(getAutocomplete().isOpen).toBeFalse();
  });

  it('Tab accepts the suggestion highlighted with the arrow keys', async () => {
    await typeAndOpen('b');
    pressKey('ArrowDown', DOWN_ARROW);
    pressKey('ArrowDown', DOWN_ARROW);

    pressKey('Tab', TAB);

    expect(host.accepted).toEqual(['D']);
  });

  it('Enter with no highlighted suggestion commits the typed text', async () => {
    await typeAndOpen('ban');

    const notPrevented = pressKey('Enter', ENTER);

    expect(host.committed).toEqual(['ban']);
    expect(host.accepted).toEqual([]);
    expect(notPrevented).toBeFalse();
    expect(getInput().value).toBe('');
    expect(getAutocomplete().isOpen).toBeFalse();
  });

  it('Enter with a highlighted suggestion is left to Material', async () => {
    await typeAndOpen('ban');
    pressKey('ArrowDown', DOWN_ARROW);

    pressKey('Enter', ENTER);

    expect(host.accepted).toEqual([]);
    expect(host.committed).toEqual([]);
  });

  it('Shift+Tab neither accepts nor commits and drops the partial text so add-on-blur has nothing to add', async () => {
    await typeAndOpen('ban');

    const notPrevented = pressKey('Tab', TAB, { shiftKey: true });

    expect(host.accepted).toEqual([]);
    expect(host.committed).toEqual([]);
    expect(notPrevented).toBeTrue();
    expect(getInput().value).toBe('');
    expect(getAutocomplete().isOpen).toBeFalse();
  });

  it('Tab on an untouched input (panel opened on focus) adds nothing and lets focus move on', async () => {
    await typeAndOpen('');
    expect(getAutocomplete().isOpen).toBeTrue();

    const notPrevented = pressKey('Tab', TAB);

    expect(host.accepted).toEqual([]);
    expect(host.committed).toEqual([]);
    expect(notPrevented).toBeTrue();
  });

  it('Enter on an untouched input does nothing', async () => {
    await typeAndOpen('');

    pressKey('Enter', ENTER);

    expect(host.accepted).toEqual([]);
    expect(host.committed).toEqual([]);
    expect(getAutocomplete().isOpen).toBeTrue();
  });

  it('ignores Enter while an IME composition is in progress', async () => {
    await typeAndOpen('ban');

    pressKey('Enter', ENTER, { isComposing: true });
    pressKey('Process', 229, { key: 'Process' });

    expect(host.committed).toEqual([]);
    expect(getInput().value).toBe('ban');
  });

  it('does nothing while the panel is closed', async () => {
    await typeAndOpen('zzz');
    expect(getAutocomplete().isOpen).toBeFalse();

    const notPrevented = pressKey('Tab', TAB);

    expect(host.accepted).toEqual([]);
    expect(host.committed).toEqual([]);
    expect(notPrevented).toBeTrue();
    expect(getInput().value).toBe('zzz');
  });

  it('ignores Tab and Enter with Ctrl, Alt or Meta held', async () => {
    await typeAndOpen('ban');

    pressKey('Tab', TAB, { ctrlKey: true });
    pressKey('Enter', ENTER, { altKey: true });
    pressKey('Enter', ENTER, { metaKey: true });

    expect(host.accepted).toEqual([]);
    expect(host.committed).toEqual([]);
  });
});
