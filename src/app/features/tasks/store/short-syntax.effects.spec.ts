import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { ShortSyntaxEffects } from './short-syntax.effects';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { addNewTagsFromShortSyntax } from './task.actions';
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
      cfg: jasmine.createSpy('cfg').and.returnValue(DEFAULT_GLOBAL_CONFIG),
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
