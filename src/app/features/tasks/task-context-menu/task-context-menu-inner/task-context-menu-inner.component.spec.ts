import { TaskContextMenuInnerComponent } from './task-context-menu-inner.component';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TaskService } from '../../task.service';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { TaskRepeatCfgService } from '../../../task-repeat-cfg/task-repeat-cfg.service';
import { MatDialog } from '@angular/material/dialog';
import { IssueService } from '../../../issue/issue.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { ProjectService } from '../../../project/project.service';
import { GlobalConfigService } from '../../../config/global-config.service';
import { TagService } from '../../../tag/tag.service';
import { TranslateModule } from '@ngx-translate/core';
import { WorkContextService } from '../../../work-context/work-context.service';
import { TaskFocusService } from '../../task-focus.service';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { DateAdapter } from '@angular/material/core';
import { of } from 'rxjs';
import { selectTaskByIdWithSubTaskData } from '../../store/task.selectors';
import { addSubTask } from '../../store/task.actions';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AddSubtaskInputService } from '../../add-subtask-input/add-subtask-input.service';
import { Project } from '../../../project/project.model';
import { Tag } from '../../../tag/tag.model';
import { DEFAULT_TASK, Task } from '../../task.model';

const projectInTreeOrder = (id: string, title: string): Project =>
  ({
    id,
    title,
    taskIds: [],
    backlogTaskIds: [],
    noteIds: [],
  }) as unknown as Project;

const tagInTreeOrder = (id: string, title: string): Tag =>
  ({
    id,
    title,
    taskIds: [],
    theme: { primary: '#999999' },
  }) as unknown as Tag;

describe('TaskContextMenuInnerComponent', () => {
  let component: TaskContextMenuInnerComponent;
  let fixture: ComponentFixture<TaskContextMenuInnerComponent>;
  let taskService: jasmine.SpyObj<TaskService>;
  let addSubtaskInputService: jasmine.SpyObj<AddSubtaskInputService>;
  let store: MockStore;

  beforeEach(async () => {
    taskService = jasmine.createSpyObj('TaskService', [
      'add',
      'createNewTaskWithDefaults',
      'currentTaskId',
    ]);
    taskService.currentTaskId.and.returnValue('some-id');
    addSubtaskInputService = jasmine.createSpyObj<AddSubtaskInputService>(
      'AddSubtaskInputService',
      ['requestOpen'],
    );

    await TestBed.configureTestingModule({
      imports: [
        TaskContextMenuInnerComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideMockStore(),
        { provide: TaskService, useValue: taskService },
        { provide: AddSubtaskInputService, useValue: addSubtaskInputService },
        {
          provide: TaskRepeatCfgService,
          useValue: { getTaskRepeatCfgById$: () => of(null) },
        },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of() }) } },
        {
          provide: IssueService,
          useValue: { issueLink: () => Promise.resolve('') },
        },
        { provide: SnackService, useValue: {} },
        {
          provide: ProjectService,
          useValue: {
            getProjectsWithoutIdInTreeOrder$: () =>
              of([
                projectInTreeOrder('project-b', 'Project B'),
                projectInTreeOrder('project-a', 'Project A'),
              ]),
            getByIdOnce$: () => of({}),
          },
        },
        {
          provide: GlobalConfigService,
          useValue: {
            appFeatures: () => ({}),
            cfg: () => ({ reminder: {}, tasks: {} }),
          },
        },
        {
          provide: TagService,
          useValue: {
            tagsNoMyDayAndNoListInTreeOrder: signal([
              tagInTreeOrder('tag-b', 'Tag B'),
              tagInTreeOrder('tag-a', 'Tag A'),
            ]),
          },
        },
        { provide: WorkContextService, useValue: { activeWorkContext$: of({}) } },
        {
          provide: TaskFocusService,
          useValue: { focusedTaskId: { set: () => {} } },
        },
        { provide: LocaleDatePipe, useValue: {} },
        { provide: DateAdapter, useValue: { getFirstDayOfWeek: () => 0 } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskContextMenuInnerComponent);
    component = fixture.componentInstance;
    component.task = {
      ...DEFAULT_TASK,
      id: 'task-default',
      title: 'Default Task',
      projectId: 'project-current',
    } as Task;
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    selectTaskByIdWithSubTaskData.release();
    store.resetSelectors();
  });

  describe('tree ordered dropdown data', () => {
    it('should expose move projects in the order provided by ProjectService', (done) => {
      component.taskSet = {
        ...DEFAULT_TASK,
        id: 'task-1',
        title: 'Task 1',
        projectId: 'project-current',
        tagIds: [],
        subTaskIds: [],
      } as unknown as Task;

      component.moveToProjectList$.subscribe((projects) => {
        expect(projects.map((project) => project.id)).toEqual(['project-b', 'project-a']);
        done();
      });
    });

    it('should expose toggle tags in the order provided by TagService', () => {
      expect(component.toggleTagList().map((tag) => tag.id)).toEqual(['tag-b', 'tag-a']);
    });
  });

  describe('duplicate()', () => {
    it('should duplicate subtasks with timeEstimate and notes', fakeAsync(() => {
      const mockTask = {
        id: 'PARENT_ID',
        title: 'Parent Task',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: ['SUB_ID'],
      } as any;

      const mockSubTask = {
        id: 'SUB_ID',
        title: 'Sub Task',
        isDone: true,
        projectId: 'P1',
        timeEstimate: 3600000,
        notes: 'Some notes',
      };

      const mockTaskWithSubTasks = {
        ...mockTask,
        subTasks: [mockSubTask],
      };

      component.task = mockTask;
      taskService.add.and.returnValue('NEW_PARENT_ID');
      taskService.createNewTaskWithDefaults.and.returnValue({
        id: 'NEW_SUB_ID',
      } as any);

      store.overrideSelector(selectTaskByIdWithSubTaskData, mockTaskWithSubTasks);
      spyOn(store, 'dispatch');

      component.duplicate();
      tick(50); // for the delay(50) in _getTaskWithSubtasks

      expect(taskService.add).toHaveBeenCalledWith(
        'Parent Task (copy)',
        false,
        jasmine.objectContaining({ projectId: 'P1' }),
        false,
      );

      expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledWith(
        jasmine.objectContaining({
          title: 'Sub Task',
          additional: jasmine.objectContaining({
            timeEstimate: 3600000,
            notes: 'Some notes',
            isDone: true,
            projectId: 'P1',
          }),
        }),
      );

      expect(store.dispatch).toHaveBeenCalledWith(
        addSubTask({
          task: { id: 'NEW_SUB_ID' } as any,
          parentId: 'NEW_PARENT_ID',
        }),
      );
    }));

    it('should duplicate parent task with notes', fakeAsync(() => {
      const mockTask = {
        id: 'PARENT_ID',
        title: 'Parent Task',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: [],
        notes: 'My important notes',
      } as any;

      component.task = mockTask;
      taskService.add.and.returnValue('NEW_PARENT_ID');

      component.duplicate();
      tick(50);

      expect(taskService.add).toHaveBeenCalledWith(
        'Parent Task (copy)',
        false,
        jasmine.objectContaining({ notes: 'My important notes' }),
        false,
      );
    }));

    it('should not include notes when parent task has no notes', fakeAsync(() => {
      const mockTask = {
        id: 'PARENT_ID',
        title: 'Parent Task',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: [],
        notes: '',
      } as any;

      component.task = mockTask;
      taskService.add.and.returnValue('NEW_PARENT_ID');

      component.duplicate();
      tick(50);

      const callArgs = taskService.add.calls.mostRecent().args[2] as any;
      expect(callArgs.notes).toBeUndefined();
    }));
  });

  describe('getElementById for task ID lookup', () => {
    it('should use getElementById for task ID in focusRelatedTaskOrNext', fakeAsync(() => {
      component.task = {
        id: 'task-with-{special}-chars',
        title: 'Test',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: [],
      } as any;

      const getByIdSpy = spyOn(document, 'getElementById').and.returnValue(null);

      component.focusRelatedTaskOrNext();
      tick(100);

      expect(getByIdSpy).toHaveBeenCalledWith('t-task-with-{special}-chars');
    }));
  });

  describe('focusFirstSubmenuItem()', () => {
    it('should focus the submenu so Material typeahead owns keyboard input', () => {
      const menu = jasmine.createSpyObj('MatMenu', ['focusFirstItem']);
      component.task = {
        id: 'T1',
        title: 'Test',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: [],
      } as any;

      component.focusFirstSubmenuItem(menu);

      expect(menu.focusFirstItem).toHaveBeenCalledWith('program');
    });
  });

  describe('addSubTask()', () => {
    it('requests the inline subtask input for the parent task', () => {
      component.task = {
        id: 'SUB_ID',
        title: 'Subtask',
        parentId: 'PARENT_ID',
        tagIds: [],
        subTaskIds: [],
      } as any;

      component.addSubTask();

      expect(addSubtaskInputService.requestOpen).toHaveBeenCalledWith('PARENT_ID');
    });
  });
});
