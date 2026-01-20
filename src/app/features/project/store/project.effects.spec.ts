import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { Subject } from 'rxjs';
import { ProjectEffects } from './project.effects';
import {
  moveAllProjectBacklogTasksToRegularList,
  updateProject,
} from './project.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { SnackService } from '../../../core/snack/snack.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { GlobalConfigState } from '../../config/global-config.model';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';

describe('ProjectEffects', () => {
  let effects: ProjectEffects;
  let actions$: Subject<any>;
  let store: MockStore;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let globalConfigServiceMock: {
    cfg: jasmine.Spy;
    updateSection: jasmine.Spy;
  };

  const createConfigState = (): GlobalConfigState => ({
    ...DEFAULT_GLOBAL_CONFIG,
    tasks: {
      ...DEFAULT_GLOBAL_CONFIG.tasks,
      defaultProjectId: 'project-1',
    },
  });

  beforeEach(() => {
    actions$ = new Subject<any>();

    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    globalConfigServiceMock = {
      cfg: jasmine.createSpy('cfg').and.returnValue(createConfigState()),
      updateSection: jasmine.createSpy('updateSection'),
    };

    TestBed.configureTestingModule({
      providers: [
        ProjectEffects,
        provideMockActions(() => actions$),
        provideMockStore(),
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceMock },
        { provide: LOCAL_ACTIONS, useValue: actions$ },
      ],
    });

    effects = TestBed.inject(ProjectEffects);
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('deleteProjectRelatedData', () => {
    it('should clear defaultProjectId when deleted project was the default', (done) => {
      // Set up config where project-1 is the default
      globalConfigServiceMock.cfg.and.returnValue({
        ...DEFAULT_GLOBAL_CONFIG,
        tasks: {
          ...DEFAULT_GLOBAL_CONFIG.tasks,
          defaultProjectId: 'project-1',
        },
      });

      effects.deleteProjectRelatedData.subscribe(() => {
        expect(globalConfigServiceMock.updateSection).toHaveBeenCalledWith('tasks', {
          defaultProjectId: null,
        });
        done();
      });

      actions$.next(
        TaskSharedActions.deleteProject({
          projectId: 'project-1',
          noteIds: [],
          allTaskIds: [],
        }),
      );
    });

    it('should NOT clear defaultProjectId when deleted project was not the default', (done) => {
      // Set up config where project-1 is the default, but we delete project-2
      globalConfigServiceMock.cfg.and.returnValue({
        ...DEFAULT_GLOBAL_CONFIG,
        tasks: {
          ...DEFAULT_GLOBAL_CONFIG.tasks,
          defaultProjectId: 'project-1',
        },
      });

      effects.deleteProjectRelatedData.subscribe(() => {
        expect(globalConfigServiceMock.updateSection).not.toHaveBeenCalled();
        done();
      });

      actions$.next(
        TaskSharedActions.deleteProject({
          projectId: 'project-2',
          noteIds: [],
          allTaskIds: [],
        }),
      );
    });

    it('should NOT clear defaultProjectId when there is no default', (done) => {
      globalConfigServiceMock.cfg.and.returnValue({
        ...DEFAULT_GLOBAL_CONFIG,
        tasks: {
          ...DEFAULT_GLOBAL_CONFIG.tasks,
          defaultProjectId: null,
        },
      });

      effects.deleteProjectRelatedData.subscribe(() => {
        expect(globalConfigServiceMock.updateSection).not.toHaveBeenCalled();
        done();
      });

      actions$.next(
        TaskSharedActions.deleteProject({
          projectId: 'project-1',
          noteIds: [],
          allTaskIds: [],
        }),
      );
    });
  });

  describe('moveAllProjectToTodayListWhenBacklogIsDisabled$', () => {
    it('should dispatch moveAllProjectBacklogTasksToRegularList when backlog is disabled', (done) => {
      effects.moveAllProjectToTodayListWhenBacklogIsDisabled$.subscribe((action: any) => {
        expect(action.type).toBe(moveAllProjectBacklogTasksToRegularList.type);
        expect(action.projectId).toBe('project-1');
        done();
      });

      actions$.next(
        updateProject({
          project: {
            id: 'project-1',
            changes: { isEnableBacklog: false },
          },
        }),
      );
    });

    it('should NOT dispatch when backlog is enabled', fakeAsync(() => {
      let emitted = false;
      effects.moveAllProjectToTodayListWhenBacklogIsDisabled$.subscribe(() => {
        emitted = true;
      });

      actions$.next(
        updateProject({
          project: {
            id: 'project-1',
            changes: { isEnableBacklog: true },
          },
        }),
      );

      tick(100);
      expect(emitted).toBe(false);
    }));

    it('should NOT dispatch when isEnableBacklog is not in changes', fakeAsync(() => {
      let emitted = false;
      effects.moveAllProjectToTodayListWhenBacklogIsDisabled$.subscribe(() => {
        emitted = true;
      });

      actions$.next(
        updateProject({
          project: {
            id: 'project-1',
            changes: { title: 'New Title' },
          },
        }),
      );

      tick(100);
      expect(emitted).toBe(false);
    }));
  });
});
