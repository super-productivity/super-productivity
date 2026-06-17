import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { MatDialog, MatDialogConfig, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { provideMockStore } from '@ngrx/store/testing';
import { TaskSelectionToolbarComponent } from './task-selection-toolbar.component';
import { TaskSelectionService } from '../task-selection.service';
import { TaskService } from '../task.service';
import { ProjectService } from '../../project/project.service';
import { TaskBatchOperationService } from '../task-batch-operation.service';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from '../task.model';
import { Project } from '../../project/project.model';
import { DialogSelectProjectComponent } from '../dialog-select-project/dialog-select-project.component';

describe('TaskSelectionToolbarComponent', () => {
  let fixture: ComponentFixture<TaskSelectionToolbarComponent>;
  let component: TaskSelectionToolbarComponent;
  let selectedIdsSig: ReturnType<typeof signal<string[]>>;
  let taskEntitiesSig: ReturnType<typeof signal<Record<string, TaskWithSubTasks>>>;
  let projectsSig: ReturnType<typeof signal<Project[]>>;
  let selectionService: jasmine.SpyObj<TaskSelectionService>;
  let taskService: jasmine.SpyObj<TaskService>;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let taskBatchOperationService: jasmine.SpyObj<TaskBatchOperationService>;

  const createTask = (id: string, overrides: Partial<Task> = {}): TaskWithSubTasks => ({
    ...DEFAULT_TASK,
    id,
    title: `Task ${id}`,
    created: 1,
    projectId: 'project-a',
    ...overrides,
    subTasks: [],
  });

  const createProject = (id: string): Project =>
    ({
      id,
      title: `Project ${id}`,
      taskIds: [],
      backlogTaskIds: [],
      noteIds: [],
    }) as unknown as Project;

  const dialogRef = <T>(value: T): MatDialogRef<unknown, T> =>
    ({ afterClosed: () => of(value) }) as unknown as MatDialogRef<unknown, T>;

  const createTaskEntities = (
    tasks: TaskWithSubTasks[],
  ): Record<string, TaskWithSubTasks> =>
    Object.fromEntries(tasks.map((task) => [task.id, task]));

  beforeEach(async () => {
    selectedIdsSig = signal<string[]>([]);
    taskEntitiesSig = signal<Record<string, TaskWithSubTasks>>({});
    projectsSig = signal<Project[]>([createProject('project-b')]);

    selectionService = jasmine.createSpyObj('TaskSelectionService', ['clearSelection'], {
      selectedIds: selectedIdsSig.asReadonly(),
      selectedCount: computed(() => selectedIdsSig().length),
    });
    taskService = jasmine.createSpyObj(
      'TaskService',
      ['setDone', 'removeMultipleTasks'],
      {
        taskEntities: taskEntitiesSig.asReadonly(),
      },
    );
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    taskBatchOperationService = jasmine.createSpyObj('TaskBatchOperationService', [
      'moveToProject',
    ]);

    await TestBed.configureTestingModule({
      imports: [
        TaskSelectionToolbarComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: TaskSelectionService, useValue: selectionService },
        { provide: TaskService, useValue: taskService },
        {
          provide: ProjectService,
          useValue: { listSortedForUI: projectsSig.asReadonly() },
        },
        { provide: MatDialog, useValue: matDialog },
        { provide: TaskBatchOperationService, useValue: taskBatchOperationService },
        provideMockStore(),
      ],
    }).compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('en', {
      F: {
        TASK: {
          CMP: {
            DELETE: 'Delete',
            MARK_DONE: 'Mark done',
            MOVE_TO_OTHER_PROJECT: 'Move to project',
          },
          TASK_SELECTION: {
            COUNT: {
              ONE: '{{count}} task selected',
              OTHER: '{{count}} tasks selected',
            },
            D_CONFIRM_DELETE: {
              MSG: {
                ONE: 'Delete {{count}} selected task?',
                OTHER: 'Delete {{count}} selected tasks?',
              },
            },
          },
        },
      },
      G: {
        CANCEL: 'Cancel',
      },
    });
    translateService.use('en');

    fixture = TestBed.createComponent(TaskSelectionToolbarComponent);
    component = fixture.componentInstance;
  });

  it('marks only selected undone tasks done via TaskService and clears selection', async () => {
    selectedIdsSig.set(['task-1', 'task-2', 'task-3']);
    taskEntitiesSig.set(
      createTaskEntities([
        createTask('task-1'),
        createTask('task-2', { isDone: true }),
        createTask('task-3'),
      ]),
    );

    await component.markAsDone();

    expect(taskService.setDone.calls.allArgs()).toEqual([['task-1'], ['task-3']]);
    expect(selectionService.clearSelection).toHaveBeenCalledOnceWith();
  });

  it('uses pluralized count translation keys', () => {
    selectedIdsSig.set(['task-1']);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('1 task selected');

    selectedIdsSig.set(['task-1', 'task-2']);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('2 tasks selected');
  });

  it('uses pluralized delete confirmation keys and clears selection after delete', async () => {
    selectedIdsSig.set(['task-1']);
    matDialog.open.and.returnValue(dialogRef(true));

    await component.deleteSelected();

    const config = matDialog.open.calls.mostRecent().args[1] as MatDialogConfig<{
      message: string;
    }>;
    expect(config.data?.message).toBe('F.TASK.TASK_SELECTION.D_CONFIRM_DELETE.MSG.ONE');
    expect(taskService.removeMultipleTasks).toHaveBeenCalledOnceWith(['task-1']);
    expect(selectionService.clearSelection).toHaveBeenCalledOnceWith();
  });

  it('processes non-recurring project moves sequentially and clears selection', async () => {
    selectedIdsSig.set(['task-1', 'task-2']);
    taskEntitiesSig.set(createTaskEntities([createTask('task-1'), createTask('task-2')]));
    matDialog.open.and.returnValue(dialogRef('project-b'));

    let runningMoves = 0;
    let maxConcurrentMoves = 0;
    taskBatchOperationService.moveToProject.and.callFake(async () => {
      runningMoves++;
      maxConcurrentMoves = Math.max(maxConcurrentMoves, runningMoves);
      await Promise.resolve();
      runningMoves--;
      return true;
    });

    await component.moveToProject();

    expect(matDialog.open.calls.mostRecent().args[0]).toBe(DialogSelectProjectComponent);
    expect(maxConcurrentMoves).toBe(1);
    expect(
      taskBatchOperationService.moveToProject.calls.allArgs().map((args) => args[0].id),
    ).toEqual(['task-1', 'task-2']);
    expect(selectionService.clearSelection).toHaveBeenCalledOnceWith();
  });
});
