import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Router, Routes } from '@angular/router';
import { ReplaySubject, Subject } from 'rxjs';
import { take } from 'rxjs/operators';
import {
  AppUriQuickActionsService,
  OPEN_TASK_FROM_APP_URI,
} from './app-uri-quick-actions.service';
import { PENDING_CAPACITOR_QUICK_ACTION } from '../../core/app-uri-actions/pending-capacitor-quick-action';
import { AppUriQuickAction } from '../../core/app-uri-actions/parse-app-uri-quick-action';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { LayoutService } from '../layout/layout.service';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { APP_ROUTES } from '../../app.routes';
import { PROJECT_CHILD_ROUTES, TAG_CHILD_ROUTES } from '../../routes/context.routes';
import { NavigateToTaskService } from '../navigate-to-task/navigate-to-task.service';
import { selectTaskEntities } from '../../features/tasks/store/task.selectors';
import { setSelectedTask } from '../../features/tasks/store/task.actions';
import { Task, TaskDetailTargetPanel } from '../../features/tasks/task.model';

describe('AppUriQuickActionsService', () => {
  let service: AppUriQuickActionsService;
  let router: jasmine.SpyObj<Router>;
  let layoutService: jasmine.SpyObj<LayoutService>;
  let pendingAction$: Subject<AppUriQuickAction>;
  let openTask$: Subject<string>;
  let isAllDataLoadedInitially$: ReplaySubject<boolean>;
  let navigateToTaskService: jasmine.SpyObj<NavigateToTaskService>;
  let store: MockStore;

  const setUp = (): void => {
    navigateToTaskService = jasmine.createSpyObj('NavigateToTaskService', ['navigate']);
    navigateToTaskService.navigate.and.returnValue(Promise.resolve(true));
    router = jasmine.createSpyObj('Router', ['navigateByUrl']);
    router.navigateByUrl.and.returnValue(Promise.resolve(true));
    layoutService = jasmine.createSpyObj('LayoutService', ['showAddTaskBar']);
    pendingAction$ = new Subject<AppUriQuickAction>();
    openTask$ = new Subject<string>();
    // A ReplaySubject, not `of(true)`: the cold-launch tests below need to
    // control *when* data init completes relative to the incoming action.
    isAllDataLoadedInitially$ = new ReplaySubject<boolean>(1);

    TestBed.configureTestingModule({
      providers: [
        AppUriQuickActionsService,
        { provide: Router, useValue: router },
        { provide: LayoutService, useValue: layoutService },
        {
          provide: DataInitStateService,
          useValue: {
            // `take(1)` mirrors the real service: without it the inner
            // observable never completes and `concatMap` stalls after the
            // first action.
            isAllDataLoadedInitially$: isAllDataLoadedInitially$.pipe(take(1)),
          } as unknown as DataInitStateService,
        },
        { provide: PENDING_CAPACITOR_QUICK_ACTION, useValue: pendingAction$ },
        { provide: OPEN_TASK_FROM_APP_URI, useValue: openTask$ },
        { provide: NavigateToTaskService, useValue: navigateToTaskService },
        provideMockStore({
          selectors: [
            {
              selector: selectTaskEntities,
              value: { live1: { id: 'live1' } as Task },
            },
          ],
        }),
      ],
    });

    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
    service = TestBed.inject(AppUriQuickActionsService);
  };

  beforeEach(() => {
    setUp();
    isAllDataLoadedInitially$.next(true);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  it('should open the add-task bar without navigating', () => {
    pendingAction$.next({ type: 'add-task' });

    expect(layoutService.showAddTaskBar).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('should navigate to the Today tag', () => {
    pendingAction$.next({ type: 'navigate', target: 'today' });

    expect(router.navigateByUrl).toHaveBeenCalledOnceWith(`/tag/${TODAY_TAG.id}/tasks`);
  });

  it('should navigate to the Inbox project', () => {
    pendingAction$.next({ type: 'navigate', target: 'inbox' });

    expect(router.navigateByUrl).toHaveBeenCalledOnceWith(
      `/project/${INBOX_PROJECT.id}/tasks`,
    );
  });

  it('should not open the add-task bar for a navigation action', () => {
    pendingAction$.next({ type: 'navigate', target: 'today' });

    expect(layoutService.showAddTaskBar).not.toHaveBeenCalled();
  });

  it('should keep two actions in order', () => {
    pendingAction$.next({ type: 'navigate', target: 'inbox' });
    pendingAction$.next({ type: 'navigate', target: 'today' });

    expect(router.navigateByUrl.calls.allArgs()).toEqual([
      [`/project/${INBOX_PROJECT.id}/tasks`],
      [`/tag/${TODAY_TAG.id}/tasks`],
    ]);
  });

  describe('open-task', () => {
    const openPanelAction = setSelectedTask({
      id: 'live1',
      taskDetailTargetPanel: TaskDetailTargetPanel.Default,
      isSkipToggle: true,
    });

    it('should navigate to a live task and then open its detail panel', fakeAsync(() => {
      openTask$.next('live1');
      flushMicrotasks();

      expect(navigateToTaskService.navigate).toHaveBeenCalledOnceWith('live1', false);
      expect(store.dispatch).toHaveBeenCalledOnceWith(openPanelAction);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    }));

    it('should open the panel only after navigation finished', fakeAsync(() => {
      // Navigation clears the selection, so dispatching first would be undone.
      let resolveNav!: (v: boolean) => void;
      navigateToTaskService.navigate.and.returnValue(
        new Promise<boolean>((r) => (resolveNav = r)),
      );
      openTask$.next('live1');
      flushMicrotasks();
      expect(store.dispatch).not.toHaveBeenCalled();

      resolveNav(true);
      flushMicrotasks();
      expect(store.dispatch).toHaveBeenCalledOnceWith(openPanelAction);
    }));

    it('should not open the panel for an unknown id', fakeAsync(() => {
      // NavigateToTaskService shows the "could not find the task" snack and
      // reports false.
      navigateToTaskService.navigate.and.returnValue(Promise.resolve(false));
      openTask$.next('live1');
      flushMicrotasks();

      expect(store.dispatch).not.toHaveBeenCalled();
    }));

    it('should not open the panel when the route change was cancelled', fakeAsync(() => {
      // NavigateToTaskService reports false when e.g. FocusOverlayOpenGuard
      // blocks the route; the panel must not open on the page the user is on.
      navigateToTaskService.navigate.and.resolveTo(false);
      openTask$.next('live1');
      flushMicrotasks();

      expect(navigateToTaskService.navigate).toHaveBeenCalledOnceWith('live1', false);
      expect(store.dispatch).not.toHaveBeenCalled();
    }));

    it('should treat a task missing from the store as archived', fakeAsync(() => {
      openTask$.next('archived1');
      flushMicrotasks();

      expect(navigateToTaskService.navigate).toHaveBeenCalledOnceWith('archived1', true);
      expect(store.dispatch).not.toHaveBeenCalled();
    }));

    it('should not take an Object.prototype key for a live task', fakeAsync(() => {
      openTask$.next('constructor');
      flushMicrotasks();

      expect(navigateToTaskService.navigate).toHaveBeenCalledOnceWith(
        'constructor',
        true,
      );
    }));
  });

  describe('cold launch', () => {
    beforeEach(() => {
      // Rebuild without emitting data-init: this is the cold-launch case, where
      // the quick action arrives while the store is still hydrating.
      service.ngOnDestroy();
      TestBed.resetTestingModule();
      setUp();
    });

    it('should buffer an action until the initial data load finished', () => {
      pendingAction$.next({ type: 'navigate', target: 'today' });

      expect(router.navigateByUrl).not.toHaveBeenCalled();

      isAllDataLoadedInitially$.next(true);

      expect(router.navigateByUrl).toHaveBeenCalledOnceWith(`/tag/${TODAY_TAG.id}/tasks`);
    });

    it('should buffer an add-task action too', () => {
      pendingAction$.next({ type: 'add-task' });

      expect(layoutService.showAddTaskBar).not.toHaveBeenCalled();

      isAllDataLoadedInitially$.next(true);

      expect(layoutService.showAddTaskBar).toHaveBeenCalledTimes(1);
    });
  });

  it('should stop handling actions after destroy', () => {
    service.ngOnDestroy();

    pendingAction$.next({ type: 'navigate', target: 'today' });

    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  describe('target routes', () => {
    // The service composes route strings by hand, as ShortcutService,
    // NavigateToTaskService and MobileBottomNavComponent all do. Nothing else
    // would notice if one of these pages were renamed or moved behind another
    // path — the quick action would just dead-end on the wildcard route.
    // `tag/:id` and `project/:id` are lazy parents whose `tasks` segment lives
    // in context.routes.ts, so flatten one level before matching.
    const flatten = (routes: Routes, prefix = ''): string[] =>
      routes.flatMap((route) => {
        if (typeof route.path !== 'string') {
          return [];
        }
        const full = prefix ? `${prefix}/${route.path}` : route.path;
        if (full === 'tag/:id') {
          return [full, ...flatten(TAG_CHILD_ROUTES, full)];
        }
        if (full === 'project/:id') {
          return [full, ...flatten(PROJECT_CHILD_ROUTES, full)];
        }
        return [full];
      });

    const declaredPaths = flatten(APP_ROUTES);

    const matchesDeclaredRoute = (url: string): boolean => {
      const segments = url.replace(/^\//, '').split('/');
      return declaredPaths.some((path) => {
        const pathSegments = path.split('/');
        return (
          pathSegments.length === segments.length &&
          // A `:id` segment matches anything; every other segment is literal.
          pathSegments.every((seg, i) => seg.startsWith(':') || seg === segments[i])
        );
      });
    };

    it('should reject a URL that matches nothing', () => {
      // Guards the guard: a matcher that accepted everything would make the
      // assertions below vacuously true.
      expect(matchesDeclaredRoute('/boards/nope/nope')).toBe(false);
      expect(matchesDeclaredRoute('/no-such-page')).toBe(false);
    });

    it('should point at routes the app actually declares', () => {
      expect(matchesDeclaredRoute(`/tag/${TODAY_TAG.id}/tasks`))
        .withContext('today')
        .toBe(true);
      expect(matchesDeclaredRoute(`/project/${INBOX_PROJECT.id}/tasks`))
        .withContext('inbox')
        .toBe(true);
    });
  });
});
