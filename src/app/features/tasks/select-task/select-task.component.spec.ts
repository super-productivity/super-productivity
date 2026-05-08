import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { Store } from '@ngrx/store';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { SelectTaskComponent } from './select-task.component';
import { WorkContextService } from '../../work-context/work-context.service';
import { Task } from '../task.model';
import { Project } from '../../project/project.model';
import { selectAllProjects } from '../../project/store/project.selectors';

describe('SelectTaskComponent', () => {
  let component: SelectTaskComponent;
  let fixture: ComponentFixture<SelectTaskComponent>;
  let mockStore: jasmine.SpyObj<Store>;
  let tasksSubject: BehaviorSubject<Task[]>;
  let projectsSubject: BehaviorSubject<Project[]>;

  const validTask: Task = {
    id: 'task-1',
    title: 'Valid task',
    isDone: false,
    subTaskIds: [],
    tagIds: [],
    parentId: undefined,
  } as Partial<Task> as Task;

  const taskWithUndefinedTitle: Task = {
    id: 'task-2',
    title: undefined,
    isDone: false,
    subTaskIds: [],
    tagIds: [],
    parentId: undefined,
  } as unknown as Task;

  const taskWithNullTitle: Task = {
    id: 'task-3',
    title: null,
    isDone: false,
    subTaskIds: [],
    tagIds: [],
    parentId: undefined,
  } as unknown as Task;

  beforeEach(async () => {
    tasksSubject = new BehaviorSubject<Task[]>([validTask]);
    projectsSubject = new BehaviorSubject<Project[]>([]);

    mockStore = jasmine.createSpyObj('Store', ['select', 'dispatch']);
    mockStore.select.and.callFake((selector) =>
      selector === selectAllProjects ? projectsSubject : tasksSubject,
    );

    const mockWorkContextService = jasmine.createSpyObj('WorkContextService', [], {
      startableTasksForActiveContext$: tasksSubject,
      trackableTasksForActiveContext$: tasksSubject,
    });

    await TestBed.configureTestingModule({
      imports: [SelectTaskComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        { provide: Store, useValue: mockStore },
        { provide: WorkContextService, useValue: mockWorkContextService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SelectTaskComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('filteredTasks', () => {
    it('should filter tasks by search text', () => {
      component.taskSelectCtrl.setValue('valid');
      fixture.detectChanges();
      const result = component.filteredTasks();
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('task-1');
    });

    it('should not crash when a task has undefined title', () => {
      tasksSubject.next([validTask, taskWithUndefinedTitle]);
      component.taskSelectCtrl.setValue('valid');
      fixture.detectChanges();
      const result = component.filteredTasks();
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('task-1');
    });

    it('should not crash when a task has null title', () => {
      tasksSubject.next([validTask, taskWithNullTitle]);
      component.taskSelectCtrl.setValue('valid');
      fixture.detectChanges();
      const result = component.filteredTasks();
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('task-1');
    });

    it('should filter tasks by project short syntax', () => {
      projectsSubject.next([
        { id: 'project-1', title: 'Work' } as Project,
        { id: 'project-2', title: 'Home' } as Project,
      ]);
      tasksSubject.next([
        { ...validTask, id: 'task-1', title: 'Write report', projectId: 'project-1' },
        { ...validTask, id: 'task-2', title: 'Write report', projectId: 'project-2' },
        { ...validTask, id: 'task-3', title: 'Call client', projectId: 'project-1' },
      ]);

      component.taskSelectCtrl.setValue('write +wor');
      fixture.detectChanges();

      const result = component.filteredTasks();
      expect(result.map((task) => task.id)).toEqual(['task-1']);
    });

    it('should show all tasks for a project when only project short syntax is entered', () => {
      projectsSubject.next([
        { id: 'project-1', title: 'Work' } as Project,
        { id: 'project-2', title: 'Home' } as Project,
      ]);
      tasksSubject.next([
        { ...validTask, id: 'task-1', title: 'Write report', projectId: 'project-1' },
        { ...validTask, id: 'task-2', title: 'Do laundry', projectId: 'project-2' },
        { ...validTask, id: 'task-3', title: 'Call client', projectId: 'project-1' },
      ]);

      component.taskSelectCtrl.setValue('+work');
      fixture.detectChanges();

      const result = component.filteredTasks();
      expect(result.map((task) => task.id)).toEqual(['task-1', 'task-3']);
    });
  });
});
