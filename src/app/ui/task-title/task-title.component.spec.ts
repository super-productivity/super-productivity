import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskTitleComponent } from './task-title.component';
import { TranslateModule } from '@ngx-translate/core';

describe('TaskTitleComponent', () => {
  let component: TaskTitleComponent;
  let fixture: ComponentFixture<TaskTitleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskTitleComponent, TranslateModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskTitleComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('readonly mode', () => {
    it('should not enter editing mode when clicked in readonly mode', () => {
      fixture.componentRef.setInput('readonly', true);
      component.tmpValue.set('Test task with https://example.com');
      fixture.detectChanges();

      const mouseEvent = new MouseEvent('mousedown', { button: 0 });
      component.onMouseDown(mouseEvent);

      expect(component.isEditing()).toBe(false);
    });

    it('should not allow focusInput in readonly mode', () => {
      fixture.componentRef.setInput('readonly', true);
      component.tmpValue.set('Test task');
      fixture.detectChanges();

      component.focusInput();

      expect(component.isEditing()).toBe(false);
    });

    it('should still render links in readonly mode', () => {
      fixture.componentRef.setInput('readonly', true);
      component.tmpValue.set('Check https://example.com for details');
      fixture.detectChanges();

      const displayEl = fixture.nativeElement.querySelector(
        '.display-value',
      ) as HTMLElement | null;
      expect(displayEl).toBeTruthy();
      expect(displayEl?.innerHTML).toContain('href="https://example.com"');
    });

    it('should allow clicking links in readonly mode without entering edit mode', () => {
      fixture.componentRef.setInput('readonly', true);
      component.tmpValue.set('Visit https://example.com');
      fixture.detectChanges();

      const anchorClickEvent = new MouseEvent('mousedown', { button: 0 });
      Object.defineProperty(anchorClickEvent, 'target', {
        value: document.createElement('a'),
        enumerable: true,
      });

      component.onMouseDown(anchorClickEvent);

      expect(component.isEditing()).toBe(false);
    });

    it('should allow editing when readonly is false', () => {
      fixture.componentRef.setInput('readonly', false);
      component.tmpValue.set('Test task');
      fixture.detectChanges();

      const mouseEvent = new MouseEvent('mousedown', { button: 0 });
      Object.defineProperty(mouseEvent, 'target', {
        value: document.createElement('span'),
        enumerable: true,
      });

      component.onMouseDown(mouseEvent);

      expect(component.isEditing()).toBe(true);
    });

    it('should not stop mousedown propagation in readonly mode (allows drag)', () => {
      fixture.componentRef.setInput('readonly', true);
      component.tmpValue.set('Test task');
      fixture.detectChanges();

      const mouseEvent = new MouseEvent('mousedown', { bubbles: true, button: 0 });
      Object.defineProperty(mouseEvent, 'target', {
        value: document.createElement('span'),
        enumerable: true,
      });

      const stopPropagationSpy = spyOn(mouseEvent, 'stopPropagation');
      component.onMouseDown(mouseEvent);

      expect(stopPropagationSpy).not.toHaveBeenCalled();
    });

    it('should stop mousedown propagation when entering edit mode', () => {
      fixture.componentRef.setInput('readonly', false);
      component.tmpValue.set('Test task');
      fixture.detectChanges();

      const mouseEvent = new MouseEvent('mousedown', { bubbles: true, button: 0 });
      Object.defineProperty(mouseEvent, 'target', {
        value: document.createElement('span'),
        enumerable: true,
      });

      const stopPropagationSpy = spyOn(mouseEvent, 'stopPropagation');
      component.onMouseDown(mouseEvent);

      expect(stopPropagationSpy).toHaveBeenCalled();
      expect(component.isEditing()).toBe(true);
    });
  });

  describe('link click propagation', () => {
    it('should stop click propagation when clicking on a link', () => {
      component.tmpValue.set('Visit https://example.com for info');
      fixture.detectChanges();

      const link = document.createElement('a');
      link.href = 'https://example.com';

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(clickEvent, 'target', {
        value: link,
        enumerable: true,
      });

      const stopPropagationSpy = spyOn(clickEvent, 'stopPropagation');
      component.onClick(clickEvent);

      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it('should stop click propagation when clicking inside a link', () => {
      component.tmpValue.set('Check [documentation](https://docs.example.com)');
      fixture.detectChanges();

      const link = document.createElement('a');
      link.href = 'https://docs.example.com';
      const span = document.createElement('span');
      span.textContent = 'documentation';
      link.appendChild(span);

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(clickEvent, 'target', {
        value: span,
        enumerable: true,
      });
      spyOn(span, 'closest').and.returnValue(link);

      const stopPropagationSpy = spyOn(clickEvent, 'stopPropagation');
      component.onClick(clickEvent);

      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it('should not stop click propagation when clicking on non-link text', () => {
      component.tmpValue.set('Just plain text task');
      fixture.detectChanges();

      const span = document.createElement('span');
      span.textContent = 'plain text';

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(clickEvent, 'target', {
        value: span,
        enumerable: true,
      });
      spyOn(span, 'closest').and.returnValue(null);

      const stopPropagationSpy = spyOn(clickEvent, 'stopPropagation');
      component.onClick(clickEvent);

      expect(stopPropagationSpy).not.toHaveBeenCalled();
    });
  });
});
