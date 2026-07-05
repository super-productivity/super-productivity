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

  const setInputValue = (value: string): void => {
    const input = getInput();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
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

  it('closes without creating a subtask on blur with content', () => {
    const closeSpy = jasmine.createSpy('closed');
    component.closed.subscribe(closeSpy);
    setInputValue('Blurred subtask');

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
});
