import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlannerDeadlineTaskComponent } from './planner-deadline-task.component';
import { TaskService } from '../../tasks/task.service';
import { DEFAULT_TASK, TaskCopy } from '../../tasks/task.model';

describe('PlannerDeadlineTaskComponent', () => {
  let fixture: ComponentFixture<PlannerDeadlineTaskComponent>;
  let taskServiceMock: jasmine.SpyObj<TaskService>;

  const card = (): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector('div') as HTMLElement;

  beforeEach(() => {
    taskServiceMock = jasmine.createSpyObj('TaskService', ['setSelectedId']);

    TestBed.configureTestingModule({
      imports: [PlannerDeadlineTaskComponent],
      providers: [{ provide: TaskService, useValue: taskServiceMock }],
    });

    fixture = TestBed.createComponent(PlannerDeadlineTaskComponent);
    fixture.componentRef.setInput('task', {
      ...DEFAULT_TASK,
      id: 'deadline-task-1',
      title: 'Hand in report',
      deadlineDay: '2026-11-20',
    } as TaskCopy);
    fixture.detectChanges();
  });

  it('opens the task on click', () => {
    card().click();

    expect(taskServiceMock.setSelectedId).toHaveBeenCalledOnceWith('deadline-task-1');
  });

  it('is reachable by keyboard and opens the task on Enter', () => {
    expect(card().getAttribute('tabindex')).toBe('0');

    card().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(taskServiceMock.setSelectedId).toHaveBeenCalledOnceWith('deadline-task-1');
  });

  it('does not open the task on other keys', () => {
    card().dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    expect(taskServiceMock.setSelectedId).not.toHaveBeenCalled();
  });
});
