import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Pipe, PipeTransform } from '@angular/core';
import { TaskCommentsComponent } from './task-comments.component';
import { TaskService } from '../task.service';
import { DEFAULT_TASK, Task } from '../task.model';
import { NgTemplateOutlet } from '@angular/common';
import { TranslateModule, TranslatePipe } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';

@Pipe({ name: 'localeDate', standalone: true })
class MockLocaleDatePipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return value != null ? `date-${value}` : '';
  }
}

describe('TaskCommentsComponent', () => {
  let component: TaskCommentsComponent;
  let fixture: ComponentFixture<TaskCommentsComponent>;
  let taskService: jasmine.SpyObj<TaskService>;

  const createTask = (overrides: Partial<Task> = {}): Task =>
    ({
      ...DEFAULT_TASK,
      id: 'task-1',
      title: 'Test',
      projectId: 'p1',
      created: Date.now(),
      ...overrides,
    }) as Task;

  beforeEach(async () => {
    taskService = jasmine.createSpyObj('TaskService', [
      'addComment',
      'updateComment',
      'deleteComment',
    ]);

    await TestBed.configureTestingModule({
      imports: [TaskCommentsComponent, TranslateModule.forRoot(), NoopAnimationsModule],
      providers: [{ provide: TaskService, useValue: taskService }],
    })
      .overrideComponent(TaskCommentsComponent, {
        set: {
          imports: [
            TranslatePipe,
            MockLocaleDatePipe,
            MatIcon,
            MatIconButton,
            NgTemplateOutlet,
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TaskCommentsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', createTask());
    fixture.detectChanges();
  });

  it('should sort comments by created ascending', () => {
    fixture.componentRef.setInput(
      'task',
      createTask({
        comments: [
          { id: '2', body: 'Later', created: 2000 },
          { id: '1', body: 'Earlier', created: 1000 },
        ],
      }),
    );
    fixture.detectChanges();
    expect(component.sortedComments().map((c) => c.id)).toEqual(['1', '2']);
  });

  it('should add a comment on save', () => {
    const task = createTask();
    fixture.componentRef.setInput('task', task);
    component.startAdd();
    component.draftText.set('Status update');
    component.saveDraft();
    expect(taskService.addComment).toHaveBeenCalledWith(task, 'Status update');
  });

  it('should cancel on Escape', () => {
    component.startAdd();
    const ev = new KeyboardEvent('keydown', { key: 'Escape' });
    spyOn(ev, 'preventDefault');
    spyOn(ev, 'stopPropagation');
    component.onDraftKeydown(ev);
    expect(component.isAdding()).toBe(false);
  });

  it('should delete a comment', () => {
    const task = createTask({
      comments: [{ id: 'cmt-1', body: 'Remove me', created: 1000 }],
    });
    fixture.componentRef.setInput('task', task);
    component.deleteComment('cmt-1');
    expect(taskService.deleteComment).toHaveBeenCalledWith(task, 'cmt-1');
  });
});
