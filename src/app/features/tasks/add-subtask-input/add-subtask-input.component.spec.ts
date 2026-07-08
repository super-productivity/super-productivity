import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { AddSubtaskInputComponent } from './add-subtask-input.component';
import { AddSubtaskInputService } from './add-subtask-input.service';
import { TaskService } from '../task.service';

describe('AddSubtaskInputService', () => {
  it('publishes the parent id to open for', () => {
    const service = new AddSubtaskInputService();

    expect(service.openRequest()).toBeNull();
    service.requestOpen('parent-1');
    expect(service.openRequest()).toBe('parent-1');
  });

  it('clears the request once consumed so it is not replayed', () => {
    const service = new AddSubtaskInputService();

    service.requestOpen('parent-1');
    service.consume();

    expect(service.openRequest()).toBeNull();
  });
});

describe('AddSubtaskInputComponent', () => {
  let fixture: ComponentFixture<AddSubtaskInputComponent>;
  let component: AddSubtaskInputComponent;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;

  const getInput = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('input') as HTMLInputElement;

  const getSubmitBtn = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('.e2e-add-subtask-submit') as HTMLButtonElement;

  const setInputValue = (value: string): void => {
    const input = getInput();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  };

  // The test env is mouse-primary (detect-it deviceType 'mouseOnly'), so
  // _shouldCommitOnBlur() is false by default — force it on to exercise the
  // touch commit-on-blur path (#8791).
  const forceTouch = (): void => {
    spyOn(
      component as unknown as { _shouldCommitOnBlur: () => boolean },
      '_shouldCommitOnBlur',
    ).and.returnValue(true);
  };

  beforeEach(async () => {
    taskServiceSpy = jasmine.createSpyObj<TaskService>('TaskService', ['addSubTaskTo']);

    await TestBed.configureTestingModule({
      imports: [AddSubtaskInputComponent, TranslateModule.forRoot()],
      providers: [{ provide: TaskService, useValue: taskServiceSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(AddSubtaskInputComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('parentId', 'parent-1');
    fixture.detectChanges();
  });

  it('focuses the input itself once rendered (no host setTimeout needed)', fakeAsync(() => {
    // The host previously focused the draft via a post-render setTimeout, which
    // races change detection on slow machines (#8617). The component now owns
    // its initial focus, so it must be focused after the first render.
    tick();

    expect(document.activeElement).toBe(getInput());
  }));

  it('commits a non-empty title on Enter and keeps the input focused', fakeAsync(() => {
    const closeSpy = jasmine.createSpy('closed');
    component.closed.subscribe(closeSpy);
    setInputValue('  New subtask  ');

    getInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    tick(100);

    expect(taskServiceSpy.addSubTaskTo).toHaveBeenCalledOnceWith('parent-1', {
      title: 'New subtask',
    });
    expect(getInput().value).toBe('');
    expect(document.activeElement).toBe(getInput());
    expect(closeSpy).not.toHaveBeenCalled();
  }));

  it('does not create a subtask on empty Enter', () => {
    setInputValue('   ');

    getInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
  });

  it('closes without creating a subtask on Escape', () => {
    const closeSpy = jasmine.createSpy('closed');
    component.closed.subscribe(closeSpy);
    setInputValue('Draft');

    getInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
    expect(component.titleDraft()).toBe('');
    expect(closeSpy).toHaveBeenCalledOnceWith('escape');
  });

  it('does not commit when Escape is followed by blur', () => {
    const closeSpy = jasmine.createSpy('closed');
    component.closed.subscribe(closeSpy);
    setInputValue('Draft');

    getInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    getInput().dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();

    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('discards a typed draft on blur on desktop (mouse-primary) and closes', () => {
    // Desktop keeps click-away-to-cancel: Enter and the submit button are the
    // reliable commit paths there, so blur must not silently create a task.
    const closeSpy = jasmine.createSpy('closed');
    component.closed.subscribe(closeSpy);
    setInputValue('Discarded on desktop');

    getInput().dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();

    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
    expect(component.titleDraft()).toBe('');
    expect(closeSpy).toHaveBeenCalledOnceWith('blur');
  });

  it('closes without creating a subtask on blur when empty', () => {
    const closeSpy = jasmine.createSpy('closed');
    component.closed.subscribe(closeSpy);
    setInputValue(' ');

    getInput().dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();

    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('commits text still held in an active IME/predictive-text composition (#8747)', fakeAsync(() => {
    // Angular's DefaultValueAccessor buffers ngModelChange during composition,
    // so titleDraft() stays empty until compositionend (which a predictive
    // keyboard only fires on a trailing space). Committing on Enter must read
    // the live input value, otherwise the subtask cannot be added unless the
    // user types a trailing space first.
    const input = getInput();
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    input.value = 'Composed subtask';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    fixture.detectChanges();

    // Buffering leaves the model empty while the DOM already has the text.
    expect(component.titleDraft()).toBe('');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    tick(100);

    expect(taskServiceSpy.addSubTaskTo).toHaveBeenCalledOnceWith('parent-1', {
      title: 'Composed subtask',
    });
    expect(getInput().value).toBe('');
  }));

  it('ignores repeated and composing Enter events', () => {
    setInputValue('New subtask');

    getInput().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', repeat: true }),
    );

    const composingEvent = new KeyboardEvent('keydown', { key: 'Enter' });
    Object.defineProperty(composingEvent, 'isComposing', { value: true });
    getInput().dispatchEvent(composingEvent);

    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
  });

  describe('commit on blur — touch only (#8791)', () => {
    it('commits a typed draft on blur when touch is active', () => {
      forceTouch();
      const closeSpy = jasmine.createSpy('closed');
      component.closed.subscribe(closeSpy);
      setInputValue('Touch blur subtask');

      getInput().dispatchEvent(new FocusEvent('blur'));
      fixture.detectChanges();

      expect(taskServiceSpy.addSubTaskTo).toHaveBeenCalledOnceWith('parent-1', {
        title: 'Touch blur subtask',
      });
      expect(closeSpy).toHaveBeenCalledOnceWith('blur');
    });

    it('commits composition-buffered text on blur, not just Enter', () => {
      // The reporting device (GrapheneOS/Vanadium) never delivered a usable
      // Enter, and blur must read the live input value so IME-buffered text is
      // still saved.
      forceTouch();
      const input = getInput();
      input.dispatchEvent(new CompositionEvent('compositionstart'));
      input.value = 'Composed on blur';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
      fixture.detectChanges();
      expect(component.titleDraft()).toBe('');

      input.dispatchEvent(new FocusEvent('blur'));
      fixture.detectChanges();

      expect(taskServiceSpy.addSubTaskTo).toHaveBeenCalledOnceWith('parent-1', {
        title: 'Composed on blur',
      });
    });
  });

  describe('submit button (#8856)', () => {
    it('always renders a submit button (desktop included, for accessibility)', () => {
      expect(getSubmitBtn()).toBeTruthy();
    });

    it('keeps the submit button out of the tab order (Enter is the keyboard path)', () => {
      // Tabbing to the button would blur + cancel the draft on desktop; keyboard
      // users commit with Enter, so the button is pointer/screen-reader-only.
      expect(getSubmitBtn().getAttribute('tabindex')).toBe('-1');
    });

    it('commits the draft and keeps the input open when the button is clicked', fakeAsync(() => {
      const closeSpy = jasmine.createSpy('closed');
      component.closed.subscribe(closeSpy);
      setInputValue('  Button subtask  ');

      getSubmitBtn().click();
      fixture.detectChanges();
      tick(100);

      expect(taskServiceSpy.addSubTaskTo).toHaveBeenCalledOnceWith('parent-1', {
        title: 'Button subtask',
      });
      expect(getInput().value).toBe('');
      expect(document.activeElement).toBe(getInput());
      expect(closeSpy).not.toHaveBeenCalled();
    }));

    it('preventDefaults the button mousedown so a desktop click keeps input focus', () => {
      const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      getSubmitBtn().dispatchEvent(ev);

      expect(ev.defaultPrevented).toBe(true);
    });

    it('adds exactly one sub-task when a touch blur and the submit click both fire', () => {
      // Real touch tap ordering: the tap blurs the input (commit + close) before
      // the button click dispatches onSubmitClick. The synchronous value-clear
      // in _addSubtaskFromInput must keep this to a single add.
      forceTouch();
      setInputValue('Once only');

      getInput().dispatchEvent(new FocusEvent('blur'));
      component.onSubmitClick();

      expect(taskServiceSpy.addSubTaskTo).toHaveBeenCalledOnceWith('parent-1', {
        title: 'Once only',
      });
    });
  });
});
