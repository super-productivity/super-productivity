import { TaskContextMenuInnerComponent } from './task-context-menu-inner.component';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TaskService } from '../../task.service';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { TaskRepeatCfgService } from '../../../task-repeat-cfg/task-repeat-cfg.service';
import { MatDialog } from '@angular/material/dialog';
import { IssueService } from '../../../issue/issue.service';
import { TaskAttachmentService } from '../../task-attachment/task-attachment.service';
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

describe('TaskContextMenuInnerComponent', () => {
  let component: TaskContextMenuInnerComponent;
  let fixture: ComponentFixture<TaskContextMenuInnerComponent>;
  let taskService: jasmine.SpyObj<TaskService>;
  let store: MockStore;

  beforeEach(async () => {
    taskService = jasmine.createSpyObj('TaskService', [
      'add',
      'createNewTaskWithDefaults',
      'currentTaskId',
    ]);
    taskService.currentTaskId.and.returnValue('some-id');

    await TestBed.configureTestingModule({
      imports: [
        TaskContextMenuInnerComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideMockStore(),
        { provide: TaskService, useValue: taskService },
        {
          provide: TaskRepeatCfgService,
          useValue: { getTaskRepeatCfgById$: () => of(null) },
        },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of() }) } },
        {
          provide: IssueService,
          useValue: { issueLink: () => Promise.resolve('') },
        },
        { provide: TaskAttachmentService, useValue: {} },
        { provide: SnackService, useValue: {} },
        {
          provide: ProjectService,
          useValue: {
            getProjectsWithoutIdSorted$: () => of([]),
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
        { provide: TagService, useValue: { tagsNoMyDayAndNoListSorted: of([]) } },
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
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    selectTaskByIdWithSubTaskData.release();
    store.resetSelectors();
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
});
