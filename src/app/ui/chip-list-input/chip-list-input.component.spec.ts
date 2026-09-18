import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { COMMA, DOWN_ARROW, ENTER, TAB } from '@angular/cdk/keycodes';
import { MatChipInputEvent } from '@angular/material/chips';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { ChipListInputComponent } from './chip-list-input.component';

describe('ChipListInputComponent', () => {
  let fixture: ComponentFixture<ChipListInputComponent>;
  let component: ChipListInputComponent;

  const getInput = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('input') as HTMLInputElement;

  const keydownOnInput = (init: KeyboardEventInit): void => {
    getInput().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChipListInputComponent, NoopAnimationsModule, TranslateModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(ChipListInputComponent);
    component = fixture.componentInstance;
    component.suggestions = [
      { id: 'A', title: 'Apple' },
      { id: 'B', title: 'Banana' },
      { id: 'C', title: 'Cherry' },
    ];
    component.model = ['A'];
    fixture.detectChanges();
  });

  it('renders a chip for each model id with a matching suggestion', () => {
    expect(component.modelItems.map((s) => s.id)).toEqual(['A']);
    expect(fixture.nativeElement.querySelectorAll('mat-chip-row').length).toBe(1);
  });

  it('filters suggestions by title prefix and excludes already added ids', () => {
    let latest: { id: string }[] = [];
    const sub = component.filteredSuggestions.subscribe((v) => (latest = v));
    component.inputCtrl.setValue('ban');
    expect(latest.map((s) => s.id)).toEqual(['B']);
    // 'Apple' matches the prefix but its id is already in the model
    component.inputCtrl.setValue('a');
    expect(latest.map((s) => s.id)).toEqual([]);
    sub.unsubscribe();
  });

  it('emits addItem for a known title and addNewItem for an unknown one', () => {
    const addSpy = jasmine.createSpy('addItem');
    const addNewSpy = jasmine.createSpy('addNewItem');
    component.addItem.subscribe(addSpy);
    component.addNewItem.subscribe(addNewSpy);
    component.add({ input: getInput(), value: 'Banana' } as MatChipInputEvent);
    component.add({ input: getInput(), value: 'Dragonfruit' } as MatChipInputEvent);
    expect(addSpy).toHaveBeenCalledOnceWith('B');
    expect(addNewSpy).toHaveBeenCalledOnceWith('Dragonfruit');
  });

  it('does not emit addItem for an id already in the model', () => {
    const addSpy = jasmine.createSpy('addItem');
    component.addItem.subscribe(addSpy);
    component.selected({
      option: { value: 'A' },
    } as unknown as MatAutocompleteSelectedEvent);
    expect(addSpy).not.toHaveBeenCalled();
    component.selected({
      option: { value: 'C' },
    } as unknown as MatAutocompleteSelectedEvent);
    expect(addSpy).toHaveBeenCalledOnceWith('C');
  });

  it('emits removeItem with the removed id', () => {
    const removeSpy = jasmine.createSpy('removeItem');
    component.removeItem.subscribe(removeSpy);
    component.remove('A');
    expect(removeSpy).toHaveBeenCalledOnceWith('A');
  });

  it('does not steal focus on init and focuses the input normally on demand', () => {
    expect(document.activeElement).not.toBe(getInput());
    getInput().focus();
    expect(document.activeElement).toBe(getInput());
  });

  it('switches to Enter-only separators on Cyrillic keys and restores on others', () => {
    keydownOnInput({ key: 'й' });
    expect(component.separatorKeysCodes).toEqual([ENTER]);
    keydownOnInput({ key: 'a' });
    expect(component.separatorKeysCodes).toEqual([ENTER, COMMA]);
    keydownOnInput({ key: 'ё' });
    expect(component.separatorKeysCodes).toEqual([ENTER]);
    keydownOnInput({ key: 'Ё' });
    expect(component.separatorKeysCodes).toEqual([ENTER]);
  });

  it('has no ctrl+enter submit output and Ctrl+Enter keeps default separators', () => {
    expect('ctrlEnterSubmit' in component).toBeFalse();
    keydownOnInput({ code: 'Enter', ctrlKey: true });
    expect(component.separatorKeysCodes).toEqual([ENTER, COMMA]);
  });

  describe('keyboard with the autocomplete panel open (#9722)', () => {
    let addSpy: jasmine.Spy;
    let addNewSpy: jasmine.Spy;

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

    const openPanelWith = async (text: string): Promise<void> => {
      const input = getInput();
      input.focus();
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(component.matAutocomplete()?.isOpen)
        .withContext('autocomplete panel should be open')
        .toBeTrue();
    };

    beforeEach(() => {
      addSpy = jasmine.createSpy('addItem');
      addNewSpy = jasmine.createSpy('addNewItem');
      component.addItem.subscribe(addSpy);
      component.addNewItem.subscribe(addNewSpy);
    });

    it('Tab accepts the first suggestion instead of creating a new item', async () => {
      await openPanelWith('ban');

      const notPrevented = pressKey('Tab', TAB);

      expect(addSpy).toHaveBeenCalledOnceWith('B');
      expect(addNewSpy).not.toHaveBeenCalled();
      expect(notPrevented).toBeFalse();
      expect(getInput().value).toBe('');
    });

    it('Tab accepts the suggestion highlighted with the arrow keys', async () => {
      component.suggestions = [
        { id: 'A', title: 'Apple' },
        { id: 'B', title: 'Banana' },
        { id: 'D', title: 'Blueberry' },
      ];
      await openPanelWith('b');
      pressKey('ArrowDown', DOWN_ARROW);
      pressKey('ArrowDown', DOWN_ARROW);

      pressKey('Tab', TAB);

      expect(addSpy).toHaveBeenCalledOnceWith('D');
      expect(addNewSpy).not.toHaveBeenCalled();
    });

    it('Enter with no highlighted suggestion creates a new item from the typed text', async () => {
      await openPanelWith('ban');

      pressKey('Enter', ENTER);

      expect(addNewSpy).toHaveBeenCalledOnceWith('ban');
      expect(addSpy).not.toHaveBeenCalled();
      expect(getInput().value).toBe('');
    });

    it('Enter with no highlighted suggestion adds the existing item on an exact title match', async () => {
      await openPanelWith('Banana');

      pressKey('Enter', ENTER);

      expect(addSpy).toHaveBeenCalledOnceWith('B');
      expect(addNewSpy).not.toHaveBeenCalled();
    });

    it('Enter with a highlighted suggestion adds only that suggestion', async () => {
      await openPanelWith('ban');
      pressKey('ArrowDown', DOWN_ARROW);

      pressKey('Enter', ENTER);

      expect(addSpy).toHaveBeenCalledOnceWith('B');
      expect(addNewSpy).not.toHaveBeenCalled();
    });

    it('Tab on an untouched input adds nothing and lets focus move on', async () => {
      await openPanelWith('');

      const notPrevented = pressKey('Tab', TAB);

      expect(addSpy).not.toHaveBeenCalled();
      expect(addNewSpy).not.toHaveBeenCalled();
      expect(notPrevented).toBeTrue();
    });

    it('Shift+Tab adds nothing and drops the partial text', async () => {
      await openPanelWith('ban');

      pressKey('Tab', TAB, { shiftKey: true });

      expect(addSpy).not.toHaveBeenCalled();
      expect(addNewSpy).not.toHaveBeenCalled();
      expect(getInput().value).toBe('');
    });
  });

  describe('suggestions setter', () => {
    it('does not mutate the passed array', () => {
      // consumers bind memoized NgRx selector output, which every other
      // subscriber holds a reference to
      const suggestions = [
        { id: 'C', title: 'Cherry' },
        { id: 'A', title: 'Apple' },
        { id: 'B', title: 'Banana' },
      ];

      component.suggestions = suggestions;

      expect(suggestions.map((s) => s.id)).toEqual(['C', 'A', 'B']);
    });

    it('sorts its own copy alphabetically by title', () => {
      component.suggestions = [
        { id: 'C', title: 'Cherry' },
        { id: 'A', title: 'Apple' },
        { id: 'B', title: 'Banana' },
      ];

      expect(component.suggestionsIn.map((s) => s.id)).toEqual(['A', 'B', 'C']);
    });
  });
});
