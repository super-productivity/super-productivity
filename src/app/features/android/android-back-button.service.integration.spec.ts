import { Component } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { provideRouter, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import { AndroidBackButtonService } from './android-back-button.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DefaultStartPage } from '../config/default-start-page.const';
import { selectIsOverlayShown } from '../focus-mode/store/focus-mode.selectors';
import { selectAllProjects } from '../project/store/project.selectors';
import { TODAY_TAG } from '../tag/tag.const';

/**
 * Integration test that exercises the decision logic against the REAL Angular
 * Router (in-memory history via provideLocationMocks) so it verifies the actual
 * serialized `router.url` strings match the service's predicates — something the
 * mocked-Router unit spec cannot prove.
 */
@Component({ standalone: true, template: '' })
class DummyComponent {}

const TODAY_URL = `/tag/${TODAY_TAG.id}/tasks`;

describe('AndroidBackButtonService integration with real Router (#7972)', () => {
  let service: AndroidBackButtonService;
  let router: Router;
  let minimizeApp: jasmine.Spy;
  let historyBack: jasmine.Spy;

  beforeEach(() => {
    // The service reads the REAL window.history.state to detect history-backed
    // overlays. Karma shares one browser context across the whole suite, so a
    // prior spec rendering an overlay (notes, task-detail-panel, side-nav, …)
    // can leave a HISTORY_STATE key set there, which would make
    // handleBackButton take the early _historyBack() branch. Reset it so these
    // tests are independent of suite run order. (provideLocationMocks gives the
    // Router its own in-memory history, so this doesn't affect routing.)
    window.history.replaceState(null, '');

    TestBed.configureTestingModule({
      providers: [
        AndroidBackButtonService,
        provideMockStore(),
        provideLocationMocks(),
        provideRouter([
          { path: 'tag/:id/tasks', component: DummyComponent },
          { path: 'tag/:id/worklog', component: DummyComponent },
          { path: 'project/:id/tasks', component: DummyComponent },
          { path: 'planner', component: DummyComponent },
          { path: 'boards', component: DummyComponent },
          { path: 'config', component: DummyComponent },
          { path: 'search', component: DummyComponent },
          { path: '**', component: DummyComponent },
        ]),
        {
          provide: GlobalConfigService,
          useValue: {
            misc: () => ({ defaultStartPage: DefaultStartPage.Today }),
            appFeatures: () => ({
              isPlannerEnabled: true,
              isSchedulerEnabled: true,
              isBoardsEnabled: true,
            }),
          },
        },
        { provide: MatDialog, useValue: { openDialogs: [] } },
      ],
    });

    const store = TestBed.inject(MockStore);
    store.overrideSelector(selectIsOverlayShown, false);
    store.overrideSelector(selectAllProjects, []);
    router = TestBed.inject(Router);
    service = TestBed.inject(AndroidBackButtonService);
    minimizeApp = spyOn(
      service as unknown as { _minimizeApp: () => void },
      '_minimizeApp',
    );
    historyBack = spyOn(
      service as unknown as { _historyBack: () => void },
      '_historyBack',
    );
  });

  it('collapses repeated tab switches: back pops to the start destination', fakeAsync(() => {
    router.navigateByUrl(TODAY_URL);
    tick();
    router.navigateByUrl('/planner');
    tick();
    router.navigateByUrl(TODAY_URL);
    tick();
    router.navigateByUrl('/planner');
    tick();
    expect(router.url).toBe('/planner');

    service.handleBackButton();
    tick();

    expect(router.url).toBe(TODAY_URL);
    expect(minimizeApp).not.toHaveBeenCalled();
    expect(historyBack).not.toHaveBeenCalled();
  }));

  it('exits the app when back is pressed on the start destination', fakeAsync(() => {
    router.navigateByUrl(TODAY_URL);
    tick();

    service.handleBackButton();
    tick();

    expect(minimizeApp).toHaveBeenCalled();
    expect(router.url).toBe(TODAY_URL);
  }));

  it('pops a project task list (top-level) to the start destination', fakeAsync(() => {
    router.navigateByUrl('/project/p1/tasks');
    tick();
    expect(router.url).toBe('/project/p1/tasks');

    service.handleBackButton();
    tick();

    expect(router.url).toBe(TODAY_URL);
  }));

  it('navigates up via history on a non-top-level page (real serialized URL)', fakeAsync(() => {
    router.navigateByUrl('/project/p1/worklog');
    tick();
    expect(router.url).toBe('/project/p1/worklog');

    service.handleBackButton();
    tick();

    expect(historyBack).toHaveBeenCalled();
    expect(minimizeApp).not.toHaveBeenCalled();
    // history.back() is stubbed, so the route stays put
    expect(router.url).toBe('/project/p1/worklog');
  }));
});
