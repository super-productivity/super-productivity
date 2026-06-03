import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { AndroidBackButtonService } from './android-back-button.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DefaultStartPage } from '../config/default-start-page.const';
import { HISTORY_STATE } from '../../app.constants';
import { TODAY_TAG } from '../tag/tag.const';
import { INBOX_PROJECT } from '../project/project.const';
import { Project } from '../project/project.model';
import { selectAllProjects } from '../project/store/project.selectors';
import { AppFeaturesConfig } from '../config/global-config.model';
import { getStartPageUrlPath } from '../config/default-start-page.util';
import { hideFocusOverlay } from '../focus-mode/store/focus-mode.actions';

const TODAY_URL = `/tag/${TODAY_TAG.id}/tasks`;

const project = (over: Partial<Project>): Project =>
  ({ id: 'p1', isArchived: false, isHiddenFromMenu: false, ...over }) as Project;

describe('AndroidBackButtonService (#7972)', () => {
  let service: AndroidBackButtonService;
  let store: MockStore;
  let routerUrl: string;
  let navigateByUrl: jasmine.Spy;
  let historyBack: jasmine.Spy;
  let minimizeApp: jasmine.Spy;
  let dispatch: jasmine.Spy;
  let misc: { defaultStartPage?: number | string } | undefined;
  let appFeatures: Record<string, boolean>;
  let openDialogs: MatDialogRef<unknown>[];

  const setProjects = (projects: Project[]): void => {
    store.overrideSelector(selectAllProjects, projects);
    store.refreshState();
  };

  const fakeDialog = (
    over: Partial<Pick<MatDialogRef<unknown>, 'disableClose'>> = {},
  ): MatDialogRef<unknown> & { close: jasmine.Spy } =>
    ({
      disableClose: false,
      close: jasmine.createSpy('close'),
      ...over,
    }) as MatDialogRef<unknown> & { close: jasmine.Spy };

  beforeEach(() => {
    routerUrl = TODAY_URL;
    navigateByUrl = jasmine.createSpy('navigateByUrl');
    misc = { defaultStartPage: DefaultStartPage.Today };
    openDialogs = [];
    appFeatures = {
      isPlannerEnabled: true,
      isSchedulerEnabled: true,
      isBoardsEnabled: true,
    };

    TestBed.configureTestingModule({
      providers: [
        AndroidBackButtonService,
        provideMockStore(),
        {
          provide: Router,
          useValue: {
            get url(): string {
              return routerUrl;
            },
            navigateByUrl,
          },
        },
        {
          provide: GlobalConfigService,
          useValue: {
            misc: () => misc,
            appFeatures: () => appFeatures,
          },
        },
        {
          provide: MatDialog,
          useValue: {
            get openDialogs(): MatDialogRef<unknown>[] {
              return openDialogs;
            },
          },
        },
      ],
    });

    store = TestBed.inject(MockStore);
    dispatch = spyOn(store, 'dispatch');
    store.overrideSelector(selectAllProjects, []);
    service = TestBed.inject(AndroidBackButtonService);

    // Prevent real side effects on globals.
    historyBack = spyOn(
      service as unknown as { _historyBack: () => void },
      '_historyBack',
    );
    minimizeApp = spyOn(
      service as unknown as { _minimizeApp: () => void },
      '_minimizeApp',
    );
    // Default: no overlays open.
    spyOn(
      service as unknown as { _isFocusOverlayShown: () => boolean },
      '_isFocusOverlayShown',
    ).and.returnValue(false);
    spyOn(
      service as unknown as { _isHistoryOverlayOpen: () => boolean },
      '_isHistoryOverlayOpen',
    ).and.returnValue(false);
  });

  describe('overlays', () => {
    it('closes a history-state overlay via window.history.back()', () => {
      (
        service as unknown as { _isHistoryOverlayOpen: jasmine.Spy }
      )._isHistoryOverlayOpen.and.returnValue(true);

      service.handleBackButton();

      expect(historyBack).toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(minimizeApp).not.toHaveBeenCalled();
    });

    it('hides focus-mode overlay directly because it is not history-backed', () => {
      (
        service as unknown as { _isFocusOverlayShown: jasmine.Spy }
      )._isFocusOverlayShown.and.returnValue(true);

      service.handleBackButton();

      expect(dispatch).toHaveBeenCalledWith(hideFocusOverlay());
      expect(historyBack).not.toHaveBeenCalled();
      expect(minimizeApp).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('modal dialogs', () => {
    it('closes the topmost open dialog instead of minimizing on the start page', () => {
      const dialog = fakeDialog();
      openDialogs = [dialog];

      service.handleBackButton();

      expect(dialog.close).toHaveBeenCalled();
      expect(minimizeApp).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('closes only the topmost dialog when several are stacked', () => {
      const lower = fakeDialog();
      const top = fakeDialog();
      openDialogs = [lower, top];

      service.handleBackButton();

      expect(top.close).toHaveBeenCalled();
      expect(lower.close).not.toHaveBeenCalled();
    });

    it('closes a dialog before navigating up from a non-top-level page', () => {
      routerUrl = '/config';
      const dialog = fakeDialog();
      openDialogs = [dialog];

      service.handleBackButton();

      expect(dialog.close).toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('swallows back for a non-closable dialog (disableClose) without closing or exiting', () => {
      const dialog = fakeDialog({ disableClose: true });
      openDialogs = [dialog];

      service.handleBackButton();

      expect(dialog.close).not.toHaveBeenCalled();
      expect(minimizeApp).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('lets a history-backed overlay take precedence over the dialog check', () => {
      (
        service as unknown as { _isHistoryOverlayOpen: jasmine.Spy }
      )._isHistoryOverlayOpen.and.returnValue(true);
      const dialog = fakeDialog();
      openDialogs = [dialog];

      service.handleBackButton();

      expect(historyBack).toHaveBeenCalled();
      expect(dialog.close).not.toHaveBeenCalled();
    });
  });

  describe('non-top-level pages navigate up normally', () => {
    [
      '/project/abc/worklog',
      `/tag/${TODAY_TAG.id}/metrics`,
      '/tag/x/quick-history',
      '/config',
      '/search',
      '/scheduled-list',
      '/donate',
    ].forEach((url) => {
      it(`uses window.history.back() on ${url}`, () => {
        routerUrl = url;

        service.handleBackButton();

        expect(historyBack).toHaveBeenCalled();
        expect(navigateByUrl).not.toHaveBeenCalled();
        expect(minimizeApp).not.toHaveBeenCalled();
      });
    });

    it('exits instead of no-oping when there is no WebView history to go back to', () => {
      routerUrl = '/config';

      service.handleBackButton(false);

      expect(minimizeApp).toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('top-level destinations', () => {
    it('pops to the start destination when not already there', () => {
      routerUrl = '/planner';

      service.handleBackButton(false);

      expect(navigateByUrl).toHaveBeenCalledWith(TODAY_URL, { replaceUrl: true });
      expect(minimizeApp).not.toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('exits the app when already on the start destination', () => {
      routerUrl = TODAY_URL;

      service.handleBackButton();

      expect(minimizeApp).toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('exits even when a project task list is the top-level destination and start', () => {
      misc = { defaultStartPage: 'my-project' };
      setProjects([project({ id: 'my-project' })]);
      routerUrl = '/project/my-project/tasks';

      service.handleBackButton();

      expect(minimizeApp).toHaveBeenCalled();
    });

    it('pops a project task list to the start destination', () => {
      routerUrl = '/project/some-project/tasks';

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith(TODAY_URL, { replaceUrl: true });
    });

    it('ignores query/fragment when comparing to the start destination', () => {
      routerUrl = `${TODAY_URL}?foo=1#bar`;

      service.handleBackButton();

      expect(minimizeApp).toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('treats a deeper path under a task list as non-top-level (navigates up)', () => {
      routerUrl = `${TODAY_URL}/123`;

      service.handleBackButton();

      expect(historyBack).toHaveBeenCalled();
      expect(minimizeApp).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });
  });

  // Full enum/project-validity matrix lives in default-start-page.util.spec.ts;
  // here we verify the service wires misc + appFeatures + the looked-up project
  // into that helper, including the store-based project lookup.
  describe('start-page resolution wiring', () => {
    it('resolves the Planner start page', () => {
      misc = { defaultStartPage: DefaultStartPage.Planner };
      routerUrl = TODAY_URL;

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith('/planner', { replaceUrl: true });
    });

    it('falls back to Today when the Planner feature is disabled', () => {
      misc = { defaultStartPage: DefaultStartPage.Planner };
      appFeatures.isPlannerEnabled = false;
      routerUrl = '/boards';

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith(TODAY_URL, { replaceUrl: true });
    });

    it('resolves the legacy Inbox start page to the inbox project', () => {
      misc = { defaultStartPage: DefaultStartPage.Inbox };
      routerUrl = TODAY_URL;

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith(`/project/${INBOX_PROJECT.id}/tasks`, {
        replaceUrl: true,
      });
    });

    it('resolves a valid project-id start page via the store', () => {
      misc = { defaultStartPage: 'proj-123' };
      setProjects([project({ id: 'proj-123' })]);
      routerUrl = TODAY_URL;

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith('/project/proj-123/tasks', {
        replaceUrl: true,
      });
    });

    it('falls back to Today when the project start page is archived', () => {
      misc = { defaultStartPage: 'proj-123' };
      setProjects([project({ id: 'proj-123', isArchived: true })]);
      routerUrl = '/planner';

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith(TODAY_URL, { replaceUrl: true });
    });

    it('falls back to Today when the project start page is missing', () => {
      misc = { defaultStartPage: 'gone' };
      setProjects([]);
      routerUrl = '/planner';

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith(TODAY_URL, { replaceUrl: true });
    });

    it('falls back to Today when misc config is undefined', () => {
      misc = undefined;
      routerUrl = '/planner';

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith(TODAY_URL, { replaceUrl: true });
    });
  });

  // Guards the _isTopLevelDestination ⇄ getStartPageUrlPath invariant: being ON
  // the resolved start destination must exit, never navigate history. Iterating
  // the enum auto-covers any future DefaultStartPage value.
  describe('start destination is always a top-level destination (back exits)', () => {
    const allBuiltInStartPages = Object.values(DefaultStartPage).filter(
      (v): v is DefaultStartPage => typeof v === 'number',
    );

    allBuiltInStartPages.forEach((startPage) => {
      it(`exits when on the resolved start page (DefaultStartPage=${startPage})`, () => {
        misc = { defaultStartPage: startPage };
        routerUrl = getStartPageUrlPath(
          startPage,
          appFeatures as unknown as AppFeaturesConfig,
          undefined,
        );

        service.handleBackButton();

        expect(minimizeApp).toHaveBeenCalled();
        expect(navigateByUrl).not.toHaveBeenCalled();
      });
    });

    it('exits when on a valid project start page', () => {
      misc = { defaultStartPage: 'proj-x' };
      setProjects([project({ id: 'proj-x' })]);
      routerUrl = '/project/proj-x/tasks';

      service.handleBackButton();

      expect(minimizeApp).toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('_isHistoryOverlayOpen (real implementation)', () => {
    it('detects an overlay history state', () => {
      (
        service as unknown as { _isHistoryOverlayOpen: jasmine.Spy }
      )._isHistoryOverlayOpen.and.callThrough();
      const original = window.history.state;
      try {
        window.history.replaceState({ [HISTORY_STATE.NOTES]: true }, '');
        expect(
          (
            service as unknown as { _isHistoryOverlayOpen: () => boolean }
          )._isHistoryOverlayOpen(),
        ).toBe(true);
      } finally {
        window.history.replaceState(original, '');
      }
    });

    it('returns false when no overlay state is present', () => {
      (
        service as unknown as { _isHistoryOverlayOpen: jasmine.Spy }
      )._isHistoryOverlayOpen.and.callThrough();
      const original = window.history.state;
      try {
        window.history.replaceState(null, '');
        expect(
          (
            service as unknown as { _isHistoryOverlayOpen: () => boolean }
          )._isHistoryOverlayOpen(),
        ).toBe(false);
      } finally {
        window.history.replaceState(original, '');
      }
    });
  });
});
