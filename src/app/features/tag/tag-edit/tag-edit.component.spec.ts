import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { DOWN_ARROW, ENTER, TAB } from '@angular/cdk/keycodes';
import { TagEditComponent } from './tag-edit.component';
import { TagService } from '../tag.service';
import { TaskService } from '../../tasks/task.service';

describe('TagEditComponent', () => {
  let fixture: ComponentFixture<TagEditComponent>;
  let component: TagEditComponent;
  let tagUpdateSpy: jasmine.Spy;
  let addTagSpy: jasmine.Spy;

  const tags = [
    { id: 'A', title: 'Apple' },
    { id: 'B', title: 'Banana' },
    { id: 'D', title: 'Blueberry' },
    { id: 'C', title: 'Cherry' },
  ];

  const getInput = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('input') as HTMLInputElement;

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

  beforeEach(async () => {
    addTagSpy = jasmine.createSpy('addTag').and.returnValue('NEW');
    await TestBed.configureTestingModule({
      imports: [TagEditComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        {
          provide: TagService,
          useValue: {
            tagsInTreeOrder: signal(tags),
            tagsNoMyDayAndNoListInTreeOrder: signal(tags),
            addTag: addTagSpy,
          },
        },
        { provide: TaskService, useValue: { updateTags: jasmine.createSpy() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TagEditComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('tagIds', ['A']);
    tagUpdateSpy = jasmine.createSpy('tagUpdate');
    component.tagUpdate.subscribe(tagUpdateSpy);
    fixture.detectChanges();
  });

  it('renders a chip for each tag id', () => {
    expect(fixture.nativeElement.querySelectorAll('mat-chip-row').length).toBe(1);
  });

  describe('keyboard with the autocomplete panel open (#9722)', () => {
    it('Tab accepts the first suggestion instead of creating a new tag', async () => {
      await openPanelWith('ban');

      const notPrevented = pressKey('Tab', TAB);

      expect(tagUpdateSpy).toHaveBeenCalledOnceWith(['A', 'B']);
      expect(addTagSpy).not.toHaveBeenCalled();
      expect(notPrevented).toBeFalse();
      expect(getInput().value).toBe('');
    });

    it('Tab accepts the suggestion highlighted with the arrow keys', async () => {
      await openPanelWith('b');
      pressKey('ArrowDown', DOWN_ARROW);
      pressKey('ArrowDown', DOWN_ARROW);

      pressKey('Tab', TAB);

      expect(tagUpdateSpy).toHaveBeenCalledOnceWith(['A', 'D']);
      expect(addTagSpy).not.toHaveBeenCalled();
    });

    it('Enter with no highlighted suggestion creates a new tag from the typed text', async () => {
      await openPanelWith('ban');

      pressKey('Enter', ENTER);

      expect(addTagSpy).toHaveBeenCalledOnceWith({ title: 'ban' });
      expect(tagUpdateSpy).toHaveBeenCalledOnceWith(['A', 'NEW']);
      expect(getInput().value).toBe('');
    });

    it('Enter with no highlighted suggestion adds the existing tag on an exact title match', async () => {
      await openPanelWith('Banana');

      pressKey('Enter', ENTER);

      expect(tagUpdateSpy).toHaveBeenCalledOnceWith(['A', 'B']);
      expect(addTagSpy).not.toHaveBeenCalled();
    });

    it('Enter with a highlighted suggestion adds only that suggestion', async () => {
      await openPanelWith('ban');
      pressKey('ArrowDown', DOWN_ARROW);

      pressKey('Enter', ENTER);

      expect(tagUpdateSpy).toHaveBeenCalledOnceWith(['A', 'B']);
      expect(addTagSpy).not.toHaveBeenCalled();
    });

    it('Tab on an untouched input adds nothing and lets focus move on', async () => {
      await openPanelWith('');

      const notPrevented = pressKey('Tab', TAB);

      expect(tagUpdateSpy).not.toHaveBeenCalled();
      expect(addTagSpy).not.toHaveBeenCalled();
      expect(notPrevented).toBeTrue();
    });

    it('Shift+Tab adds nothing and drops the partial text', async () => {
      await openPanelWith('ban');

      pressKey('Tab', TAB, { shiftKey: true });

      expect(tagUpdateSpy).not.toHaveBeenCalled();
      expect(addTagSpy).not.toHaveBeenCalled();
      expect(getInput().value).toBe('');
    });
  });
});
