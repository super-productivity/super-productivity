import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskTitleComponent } from './task-title.component';
import { TranslateModule } from '@ngx-translate/core';
import { EMPTY } from 'rxjs';
import { MentionConfigService } from '../../features/tasks/mention-config.service';

describe('TaskTitleComponent', () => {
  let component: TaskTitleComponent;
  let fixture: ComponentFixture<TaskTitleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskTitleComponent, TranslateModule.forRoot()],
      providers: [{ provide: MentionConfigService, useValue: { mentionConfig$: EMPTY } }],
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

      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', {
        value: document.createElement('span'),
        enumerable: true,
      });

      component.onClick(clickEvent);

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

      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', {
        value: document.createElement('a'),
        enumerable: true,
      });

      component.onClick(clickEvent);

      expect(component.isEditing()).toBe(false);
    });

    it('should allow editing when readonly is false', () => {
      fixture.componentRef.setInput('readonly', false);
      component.tmpValue.set('Test task');
      fixture.detectChanges();

      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', {
        value: document.createElement('span'),
        enumerable: true,
      });

      component.onClick(clickEvent);

      expect(component.isEditing()).toBe(true);
    });

    it('should not stop click propagation in readonly mode', () => {
      fixture.componentRef.setInput('readonly', true);
      component.tmpValue.set('Test task');
      fixture.detectChanges();

      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', {
        value: document.createElement('span'),
        enumerable: true,
      });

      const stopPropagationSpy = spyOn(clickEvent, 'stopPropagation');
      component.onClick(clickEvent);

      expect(stopPropagationSpy).not.toHaveBeenCalled();
    });

    it('should stop click propagation when entering edit mode', () => {
      fixture.componentRef.setInput('readonly', false);
      component.tmpValue.set('Test task');
      fixture.detectChanges();

      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', {
        value: document.createElement('span'),
        enumerable: true,
      });

      const stopPropagationSpy = spyOn(clickEvent, 'stopPropagation');
      component.onClick(clickEvent);

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

    it('should enter edit mode and stop click propagation when clicking on non-link text', () => {
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

      expect(stopPropagationSpy).toHaveBeenCalled();
      expect(component.isEditing()).toBe(true);
    });
  });
});
