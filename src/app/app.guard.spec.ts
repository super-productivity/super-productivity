import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { DefaultStartPageGuard } from './app.guard';
import { DataInitStateService } from './core/data-init/data-init-state.service';
import { GlobalConfigService } from './features/config/global-config.service';
import { ProjectService } from './features/project/project.service';
import { TODAY_TAG } from './features/tag/tag.const';
import { INBOX_PROJECT } from './features/project/project.const';
import { Project } from './features/project/project.model';

describe('DefaultStartPageGuard', () => {
  let guard: DefaultStartPageGuard;
  let router: Router;
  let misc$: BehaviorSubject<{ defaultStartPage?: number | string } | undefined>;
  let appFeatures: jasmine.Spy;
  let getByIdOnce$: jasmine.Spy;

  const TODAY_URL = `/tag/${TODAY_TAG.id}/tasks`;

  const runGuard = async (): Promise<UrlTree> => {
    const result = await guard.canActivate({} as any, {} as any).toPromise();
    if (!result) {
      throw new Error('guard returned falsy');
    }
    return result;
  };

  const fakeProject = (overrides: Partial<Project> = {}): Project =>
    ({
      id: 'p1',
      title: 'Project',
      isArchived: false,
      isHiddenFromMenu: false,
      ...overrides,
    }) as Project;

  beforeEach(() => {
    misc$ = new BehaviorSubject<{ defaultStartPage?: number | string } | undefined>(
      undefined,
    );
    appFeatures = jasmine.createSpy('appFeatures').and.returnValue({
      isPlannerEnabled: true,
      isSchedulerEnabled: true,
      isBoardsEnabled: true,
    });
    getByIdOnce$ = jasmine.createSpy('getByIdOnce$').and.returnValue(of(undefined));

    TestBed.configureTestingModule({
      providers: [
        DefaultStartPageGuard,
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: of(true) },
        },
        {
          provide: GlobalConfigService,
          useValue: { misc$, appFeatures },
        },
        {
          provide: ProjectService,
          useValue: { getByIdOnce$ },
        },
      ],
    });
    guard = TestBed.inject(DefaultStartPageGuard);
    router = TestBed.inject(Router);
  });

  const expectUrl = (tree: UrlTree, path: string): void => {
    expect(router.serializeUrl(tree)).toBe(path);
  };

  it('routes undefined → Today', async () => {
    misc$.next({ defaultStartPage: undefined });
    expectUrl(await runGuard(), TODAY_URL);
  });

  it('routes DefaultStartPage.Today → Today', async () => {
    misc$.next({ defaultStartPage: 0 });
    expectUrl(await runGuard(), TODAY_URL);
  });

  it('routes legacy Inbox (1) → /project/INBOX_PROJECT/tasks', async () => {
    misc$.next({ defaultStartPage: 1 });
    expectUrl(await runGuard(), `/project/${INBOX_PROJECT.id}/tasks`);
  });

  it('routes Planner when feature enabled', async () => {
    misc$.next({ defaultStartPage: 2 });
    expectUrl(await runGuard(), '/planner');
  });

  it('falls back to Today when Planner disabled', async () => {
    appFeatures.and.returnValue({
      isPlannerEnabled: false,
      isSchedulerEnabled: true,
      isBoardsEnabled: true,
    });
    misc$.next({ defaultStartPage: 2 });
    expectUrl(await runGuard(), TODAY_URL);
  });

  it('falls back to Today when Schedule disabled', async () => {
    appFeatures.and.returnValue({
      isPlannerEnabled: true,
      isSchedulerEnabled: false,
      isBoardsEnabled: true,
    });
    misc$.next({ defaultStartPage: 3 });
    expectUrl(await runGuard(), TODAY_URL);
  });

  it('falls back to Today when Boards disabled', async () => {
    appFeatures.and.returnValue({
      isPlannerEnabled: true,
      isSchedulerEnabled: true,
      isBoardsEnabled: false,
    });
    misc$.next({ defaultStartPage: 4 });
    expectUrl(await runGuard(), TODAY_URL);
  });

  it('routes to project when project exists', async () => {
    getByIdOnce$.and.returnValue(of(fakeProject({ id: 'p1' })));
    misc$.next({ defaultStartPage: 'p1' });
    expectUrl(await runGuard(), '/project/p1/tasks');
  });

  it('falls back to Today when project is missing', async () => {
    getByIdOnce$.and.returnValue(of(undefined));
    misc$.next({ defaultStartPage: 'does-not-exist' });
    expectUrl(await runGuard(), TODAY_URL);
  });

  it('falls back to Today when project is archived', async () => {
    getByIdOnce$.and.returnValue(of(fakeProject({ id: 'p1', isArchived: true })));
    misc$.next({ defaultStartPage: 'p1' });
    expectUrl(await runGuard(), TODAY_URL);
  });

  it('falls back to Today when project is hidden from menu', async () => {
    getByIdOnce$.and.returnValue(of(fakeProject({ id: 'p1', isHiddenFromMenu: true })));
    misc$.next({ defaultStartPage: 'p1' });
    expectUrl(await runGuard(), TODAY_URL);
  });

  it('falls back to Today when getByIdOnce$ errors', async () => {
    getByIdOnce$.and.returnValue(throwError(() => new Error('boom')));
    misc$.next({ defaultStartPage: 'p1' });
    expectUrl(await runGuard(), TODAY_URL);
  });

  // Regression: empty-string ids previously threw synchronously in
  // ProjectService.getByIdOnce$ and blocked the guard entirely.
  it('falls back to Today when defaultStartPage is an empty string', async () => {
    misc$.next({ defaultStartPage: '' });
    expectUrl(await runGuard(), TODAY_URL);
    expect(getByIdOnce$).not.toHaveBeenCalled();
  });

  it('falls back to Today when misc config itself is undefined', async () => {
    misc$.next(undefined);
    expectUrl(await runGuard(), TODAY_URL);
  });
});
