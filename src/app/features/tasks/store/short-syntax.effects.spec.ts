import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import {
  DateInputLocale,
  DEFAULT_DATE_INPUT_LOCALE,
} from '../../../core/date-time-format/date-input-locale';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, firstValueFrom, of, Subject } from 'rxjs';
import { ShortSyntaxEffects } from './short-syntax.effects';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { addNewTagsFromShortSyntax, addSubTask } from './task.actions';
import { TaskService } from '../task.service';
import { TagService } from '../../tag/tag.service';
import { ProjectService } from '../../project/project.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { SnackService } from '../../../core/snack/snack.service';
import { MatDialog } from '@angular/material/dialog';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { DEFAULT_TASK, Task } from '../task.model';
import { WorkContextType } from '../../work-context/work-context.model';
import { TaskTimeSyncService } from '../task-time-sync.service';
import { IssueSharedTitleService } from '../../issue/two-way-sync/issue-shared-title.service';

describe('ShortSyntaxEffects', () => {
  let effects: ShortSyntaxEffects;
  let actions$: Subject<any>;
  let taskServiceMock: {
    getByIdOnce$: jasmine.Spy;
  };
  let tagServiceMock: {
    tagsNoMyDayAndNoList$: BehaviorSubject<any[]>;
    getAddTagActionAndId: jasmine.Spy;
  };
  let projectServiceMock: {
    list$: BehaviorSubject<any[]>;
    getByIdOnce$: jasmine.Spy;
  };
  let globalConfigServiceMock: {
    tasks$: BehaviorSubject<any>;
    cfg: jasmine.Spy;
  };
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let matDialogMock: {
    open: jasmine.Spy;
  };
  let layoutServiceSpy: jasmine.SpyObj<LayoutService>;
  let workContextServiceMock: {
    activeWorkContextId: string;
  };
  let taskTimeSyncServiceSpy: jasmine.SpyObj<TaskTimeSyncService>;
  let sharedTitleSpy: jasmine.SpyObj<IssueSharedTitleService>;
  let dateInputLocale: DateInputLocale;

  const createTask = (id: string, partial: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id,
    title: `Task ${id}`,
    projectId: 'project-1',
    created: Date.now(),
    tagIds: [],
    ...partial,
  });

  beforeEach(() => {
    actions$ = new Subject<any>();

    taskServiceMock = {
      getByIdOnce$: jasmine
        .createSpy('getByIdOnce$')
        .and.callFake((id: string) => of(createTask(id))),
    };

    tagServiceMock = {
      tagsNoMyDayAndNoList$: new BehaviorSubject([{ id: 'tag-1', title: 'existingTag' }]),
      getAddTagActionAndId: jasmine
        .createSpy('getAddTagActionAndId')
        .and.callFake(() => ({
          action: { type: '[Tag] Add Tag' },
          id: 'new-tag-id',
        })),
    };

    projectServiceMock = {
      list$: new BehaviorSubject([
        { id: 'project-1', title: 'Project One' },
        { id: 'project-2', title: 'Project Two' },
      ]),
      getByIdOnce$: jasmine
        .createSpy('getByIdOnce$')
        .and.returnValue(of({ id: 'project-1' })),
    };

    globalConfigServiceMock = {
      tasks$: new BehaviorSubject({
        ...DEFAULT_GLOBAL_CONFIG.tasks,
        defaultProjectId: null,
      }),
      cfg: jasmine.createSpy('cfg').and.returnValue({
        ...DEFAULT_GLOBAL_CONFIG,
        shortSyntax: {
          ...DEFAULT_GLOBAL_CONFIG.shortSyntax,
          // Use 'keep-and-attach' for tests that expect URL attachments to be created
          urlBehavior: 'keep-and-attach',
        },
      }),
    };

    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    layoutServiceSpy = jasmine.createSpyObj('LayoutService', ['hideAddTaskBar']);

    const dialogRefMock = {
      afterClosed: () => of(true),
    };
    matDialogMock = {
      open: jasmine.createSpy('open').and.returnValue(dialogRefMock),
    };

    workContextServiceMock = {
      activeWorkContextId: 'project-1',
    };
    taskTimeSyncServiceSpy = jasmine.createSpyObj('TaskTimeSyncService', ['flushOne']);
    sharedTitleSpy = jasmine.createSpyObj('IssueSharedTitleService', ['getSharedTitle']);
    sharedTitleSpy.getSharedTitle.and.resolveTo(undefined);
    dateInputLocale = DEFAULT_DATE_INPUT_LOCALE;

    TestBed.configureTestingModule({
      providers: [
        ShortSyntaxEffects,
        provideMockActions(() => actions$),
        provideMockStore(),
        { provide: TaskService, useValue: taskServiceMock },
        { provide: TagService, useValue: tagServiceMock },
        { provide: ProjectService, useValue: projectServiceMock },
        { provide: GlobalConfigService, useValue: globalConfigServiceMock },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: MatDialog, useValue: matDialogMock },
        { provide: LayoutService, useValue: layoutServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceMock },
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        {
          provide: DateTimeFormatService,
          useValue: { dateInputLocale: () => dateInputLocale },
        },
        { provide: TaskTimeSyncService, useValue: taskTimeSyncServiceSpy },
        { provide: IssueSharedTitleService, useValue: sharedTitleSpy },
      ],
    });

    effects = TestBed.inject(ShortSyntaxEffects);
  });

  describe('shortSyntax$', () => {
    it('should NOT emit when isIgnoreShortSyntax is true', fakeAsync(() => {
      const task = createTask('task-1', { title: '#newtag some task' });
      taskServiceMock.getByIdOnce$.and.returnValue(of(task));

      let emitted = false;
      effects.shortSyntax$.subscribe(() => {
        emitted = true;
      });

      actions$.next(
        TaskSharedActions.addTask({
          task,
          workContextId: 'project-1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
          isIgnoreShortSyntax: true,
        }),
      );

      tick(100);
      expect(emitted).toBe(false);
    }));

    it('should apply existing tag when using short syntax', fakeAsync(() => {
      const task = createTask('task-1', { title: '#existingTag some task' });
      taskServiceMock.getByIdOnce$.and.returnValue(of(task));

      let emittedAction: any = null;
      effects.shortSyntax$.subscribe((action) => {
        emittedAction = action;
      });

      actions$.next(
        TaskSharedActions.addTask({
          task,
          workContextId: 'project-1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );

      tick(100);

      // The effect should emit an applyShortSyntax action
      expect(emittedAction).toBeDefined();
      expect(emittedAction.type).toBe(TaskSharedActions.applyShortSyntax.type);
    }));

    it('should parse dates in the date input locale', async () => {
      dateInputLocale = { language: 'de', isDayFirst: true };
      const task = createTask('task-1', { title: 'Call @morgen 15 Uhr' });
      taskServiceMock.getByIdOnce$.and.returnValue(of(task));
      const emitted = firstValueFrom(effects.shortSyntax$);

      actions$.next(
        TaskSharedActions.addTask({
          task,
          workContextId: 'project-1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );

      const action = (await emitted) as ReturnType<
        typeof TaskSharedActions.applyShortSyntax
      >;
      expect(action.taskChanges.title).toBe('Call');
      expect(new Date(action.taskChanges.dueWithTime as number).getHours()).toBe(15);
    });

    it('should parse short syntax for sub-tasks added via addSubTask (#8568)', fakeAsync(() => {
      const task = createTask('sub-1', {
        title: 'Buy milk 15m',
        parentId: 'parent-1',
      });
      taskServiceMock.getByIdOnce$.and.returnValue(of(task));

      let emittedAction: any = null;
      effects.shortSyntax$.subscribe((action) => {
        emittedAction = action;
      });

      actions$.next(addSubTask({ task, parentId: 'parent-1' }));

      tick(100);

      expect(emittedAction).toBeDefined();
      expect(emittedAction.type).toBe(TaskSharedActions.applyShortSyntax.type);
      expect(emittedAction.taskChanges.timeEstimate).toBe(15 * 60 * 1000);
      expect(emittedAction.taskChanges.title).toBe('Buy milk');
    }));

    it('should NOT parse short syntax for addSubTask when isIgnoreShortSyntax is true', fakeAsync(() => {
      const task = createTask('sub-1', {
        title: 'Buy milk 15m',
        parentId: 'parent-1',
      });
      taskServiceMock.getByIdOnce$.and.returnValue(of(task));

      let emitted = false;
      effects.shortSyntax$.subscribe(() => {
        emitted = true;
      });

      actions$.next(
        addSubTask({ task, parentId: 'parent-1', isIgnoreShortSyntax: true }),
      );

      tick(100);
      expect(emitted).toBe(false);
    }));

    it('should NOT process update actions that do not change title', fakeAsync(() => {
      const task = createTask('task-1', { title: 'some task' });
      taskServiceMock.getByIdOnce$.and.returnValue(of(task));

      let emitted = false;
      effects.shortSyntax$.subscribe(() => {
        emitted = true;
      });

      actions$.next(
        TaskSharedActions.updateTask({
          task: {
            id: 'task-1',
            changes: { isDone: true },
          },
        }),
      );

      tick(100);
      expect(emitted).toBe(false);
    }));

    it('should flush pending timer deltas before an absolute short-syntax time edit', fakeAsync(() => {
      const task = createTask('task-1', { title: 'Task 10m/1h' });
      taskServiceMock.getByIdOnce$.and.returnValue(of(task));
      effects.shortSyntax$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { title: task.title } },
        }),
      );
      tick(100);

      expect(taskTimeSyncServiceSpy.flushOne).toHaveBeenCalledOnceWith('task-1');
    }));

    describe('title edit of a task whose title syncs both ways', () => {
      const editTitle = (title: string): any[] => {
        const task = createTask('task-1', {
          title,
          issueId: 'item-1',
          issueType: 'PLAINSPACE',
          issueProviderId: 'provider-1',
        });
        taskServiceMock.getByIdOnce$.and.returnValue(of(task));
        const emitted: any[] = [];
        effects.shortSyntax$.subscribe((action) => emitted.push(action));
        actions$.next(
          TaskSharedActions.updateTask({
            task: { id: 'task-1', changes: { title } },
          }),
        );
        tick(100);
        return emitted;
      };

      it('leaves the short syntax already in the shared title as text', fakeAsync(() => {
        sharedTitleSpy.getSharedTitle.and.resolveTo('Prep #existingTag for @fri 30m');

        expect(editTitle('Prepare #existingTag for @fri 30m')).toEqual([]);
      }));

      it('applies the short syntax typed in this edit', fakeAsync(() => {
        sharedTitleSpy.getSharedTitle.and.resolveTo('Prep #urgent for @fri 30m');

        const [action] = editTitle('Prep #urgent for @fri 30m #existingTag 1h');

        expect(action.type).toBe(TaskSharedActions.applyShortSyntax.type);
        expect(action.taskChanges).toEqual({
          title: 'Prep #urgent for @fri 30m',
          timeEstimate: 3600000,
          tagIds: ['tag-1'],
        });
      }));

      it('is not asked for a new task', fakeAsync(() => {
        const task = createTask('task-1', { title: 'Buy #existingTag' });
        taskServiceMock.getByIdOnce$.and.returnValue(of(task));
        effects.shortSyntax$.subscribe();
        actions$.next(
          TaskSharedActions.addTask({
            task,
            workContextId: 'project-1',
            workContextType: WorkContextType.PROJECT,
            isAddToBacklog: false,
            isAddToBottom: false,
          }),
        );
        tick(100);

        expect(sharedTitleSpy.getSharedTitle).not.toHaveBeenCalled();
      }));
    });

    it('should set priority from a title edit with the default config', fakeAsync(() => {
      globalConfigServiceMock.cfg.and.returnValue(DEFAULT_GLOBAL_CONFIG);
      const task = createTask('task-1', { title: 'Fix login bug p1', priority: 1 });
      taskServiceMock.getByIdOnce$.and.returnValue(of(task));

      let emittedAction: any = null;
      effects.shortSyntax$.subscribe((action) => {
        emittedAction = action;
      });

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { title: task.title } },
        }),
      );
      tick(100);

      expect(emittedAction.type).toBe(TaskSharedActions.applyShortSyntax.type);
      expect(emittedAction.taskChanges).toEqual({
        priority: 3,
        title: 'Fix login bug',
      });
    }));

    it('should add URL as attachment when updating task title with a URL', fakeAsync(() => {
      const task = createTask('task-1', {
        title: 'Check out www.example.com for more info',
        attachments: [],
      });
      taskServiceMock.getByIdOnce$.and.returnValue(of(task));

      let emittedAction: any = null;
      effects.shortSyntax$.subscribe((action) => {
        emittedAction = action;
      });

      actions$.next(
        TaskSharedActions.updateTask({
          task: {
            id: 'task-1',
            changes: { title: 'Check out www.example.com for more info' },
          },
        }),
      );

      tick(100);

      expect(emittedAction).toBeDefined();
      expect(emittedAction.type).toBe(TaskSharedActions.applyShortSyntax.type);
      expect(emittedAction.taskChanges.attachments).toBeDefined();
      expect(emittedAction.taskChanges.attachments.length).toBe(1);
      expect(emittedAction.taskChanges.attachments[0].path).toContain('example.com');
    }));

    it('should preserve existing attachments when adding new URL attachment', fakeAsync(() => {
      const existingAttachment = {
        id: 'existing-attachment-1',
        type: 'LINK' as const,
        title: 'Existing Link',
        path: 'https://existing.com',
        originalImgPath: undefined,
      };
      const task = createTask('task-1', {
        title: 'Check out www.newurl.com for details',
        attachments: [existingAttachment],
      });
      taskServiceMock.getByIdOnce$.and.returnValue(of(task));

      let emittedAction: any = null;
      effects.shortSyntax$.subscribe((action) => {
        emittedAction = action;
      });

      actions$.next(
        TaskSharedActions.updateTask({
          task: {
            id: 'task-1',
            changes: { title: 'Check out www.newurl.com for details' },
          },
        }),
      );

      tick(100);

      expect(emittedAction).toBeDefined();
      expect(emittedAction.type).toBe(TaskSharedActions.applyShortSyntax.type);
      expect(emittedAction.taskChanges.attachments).toBeDefined();
      expect(emittedAction.taskChanges.attachments.length).toBe(2);
      // Check existing attachment is preserved
      expect(emittedAction.taskChanges.attachments[0]).toEqual(existingAttachment);
      // Check new attachment was added
      expect(emittedAction.taskChanges.attachments[1].path).toContain('newurl.com');
    }));
  });

  describe('shortSyntaxAddNewTags$', () => {
    it('should open confirmation dialog and create tags when confirmed', fakeAsync(() => {
      const task = createTask('task-1', { title: 'some task', tagIds: [] });
      taskServiceMock.getByIdOnce$.and.returnValue(of(task));

      const dialogRefMock = {
        afterClosed: () => of(true),
      };
      matDialogMock.open.and.returnValue(dialogRefMock);

      const emittedActions: any[] = [];
      effects.shortSyntaxAddNewTags$.subscribe((action) => {
        emittedActions.push(action);
      });

      actions$.next(
        addNewTagsFromShortSyntax({ taskId: 'task-1', newTitles: ['NewTag'] }),
      );

      tick(100);

      // Should have hidden the add task bar
      expect(layoutServiceSpy.hideAddTaskBar).toHaveBeenCalled();
      // Should have opened confirmation dialog
      expect(matDialogMock.open).toHaveBeenCalled();
      // Should have gotten add tag action and id
      expect(tagServiceMock.getAddTagActionAndId).toHaveBeenCalled();
      // Should have emitted actions
      expect(emittedActions.length).toBeGreaterThan(0);
    }));

    it('should NOT create tags when dialog is cancelled', fakeAsync(() => {
      const task = createTask('task-1', { title: 'some task', tagIds: [] });
      taskServiceMock.getByIdOnce$.and.returnValue(of(task));

      const dialogRefMock = {
        afterClosed: () => of(false),
      };
      matDialogMock.open.and.returnValue(dialogRefMock);

      const emittedActions: any[] = [];
      effects.shortSyntaxAddNewTags$.subscribe((action) => {
        emittedActions.push(action);
      });

      actions$.next(
        addNewTagsFromShortSyntax({ taskId: 'task-1', newTitles: ['NewTag'] }),
      );

      tick(100);

      // Should have hidden the add task bar
      expect(layoutServiceSpy.hideAddTaskBar).toHaveBeenCalled();
      // Should have opened confirmation dialog
      expect(matDialogMock.open).toHaveBeenCalled();
      // Should NOT have created any tags (no actions emitted)
      expect(emittedActions.length).toBe(0);
    }));
  });
});
