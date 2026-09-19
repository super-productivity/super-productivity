import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { TaskPriorityIndicatorComponent } from './task-priority-indicator.component';
import { TASK_PRIORITY_ICON, TASK_PRIORITY_LABEL_KEY } from '../task-priority.const';
import { TaskPriority } from '../task.model';

describe('TaskPriorityIndicatorComponent', () => {
  const create = (
    priority: TaskPriority,
  ): ComponentFixture<TaskPriorityIndicatorComponent> => {
    const fixture = TestBed.createComponent(TaskPriorityIndicatorComponent);
    fixture.componentRef.setInput('priority', priority);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TaskPriorityIndicatorComponent, TranslateModule.forRoot()],
    });
  });

  for (const priority of ['high', 'medium', 'low'] as const) {
    describe(`priority "${priority}"`, () => {
      it('exposes the priority as a host attribute, so only its own styles colour it', () => {
        const fixture = create(priority);

        expect(fixture.nativeElement.getAttribute('data-priority')).toBe(priority);
      });

      it('renders the mapped icon glyph', () => {
        const fixture = create(priority);
        const icon: HTMLElement = fixture.nativeElement.querySelector('mat-icon');

        expect(icon.textContent?.trim()).toBe(TASK_PRIORITY_ICON[priority]);
      });

      it('labels the icon for screen readers', () => {
        const fixture = create(priority);
        const icon: HTMLElement = fixture.nativeElement.querySelector('mat-icon');

        // With `TranslateModule.forRoot()` and no loader the pipe echoes the key.
        expect(icon.getAttribute('aria-label')).toBe(TASK_PRIORITY_LABEL_KEY[priority]);
        // MatIcon force-sets `aria-hidden="true"` unless a static one is present,
        // which would hide the label again.
        expect(icon.getAttribute('aria-hidden')).toBe('false');
      });
    });
  }
});
