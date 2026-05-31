import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { NavigationEnd, Router } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { TranslateService } from '@ngx-translate/core';

import { PageTitleComponent } from './page-title.component';
import { WorkContextService } from '../../../features/work-context/work-context.service';
import { TaskViewCustomizerService } from '../../../features/task-view-customizer/task-view-customizer.service';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { T } from '../../../t.const';

describe('PageTitleComponent', () => {
  let routerEvents$: Subject<NavigationEnd>;
  let routerStub: { events: Subject<NavigationEnd>; url: string };

  const setupComponent = (initialUrl: string): PageTitleComponent => {
    routerStub.url = initialUrl;
    return TestBed.createComponent(PageTitleComponent).componentInstance;
  };

  beforeEach(async () => {
    routerEvents$ = new Subject<NavigationEnd>();
    routerStub = { events: routerEvents$, url: '/' };

    await TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: routerStub },
        {
          provide: BreakpointObserver,
          useValue: { observe: () => of({ matches: false }) },
        },
        {
          provide: WorkContextService,
          useValue: {
            activeWorkContextTitle$: of('Today'),
            activeWorkContextTypeAndId$: of({
              activeId: 'TODAY',
              activeType: 'TAG',
            }),
          },
        },
        {
          provide: TaskViewCustomizerService,
          useValue: { isCustomized: () => false },
        },
        {
          provide: GlobalConfigService,
          useValue: { cfg: () => ({ keyboard: {} }) },
        },
        {
          provide: TranslateService,
          useValue: { instant: (key: string) => key },
        },
      ],
    })
      .overrideComponent(PageTitleComponent, {
        set: { imports: [], template: '' },
      })
      .compileComponents();
  });

  describe('displayTitle()', () => {
    const cases: Array<[string, string]> = [
      ['/schedule', T.MH.SCHEDULE],
      ['/planner', T.MH.PLANNER],
      ['/boards', T.MH.BOARDS],
      ['/habits', T.MH.HABITS],
      ['/search', T.MH.SEARCH],
      ['/scheduled-list', T.MH.ALL_PLANNED_LIST],
      ['/donate', T.MH.DONATE],
      ['/config', T.PS.GLOBAL_SETTINGS],
    ];

    cases.forEach(([url, expectedKey]) => {
      it(`returns "${expectedKey}" for ${url}`, () => {
        const c = setupComponent(url);
        expect(c.displayTitle()).toBe(expectedKey);
      });
    });

    it('falls through to activeWorkContextTitle for non-special routes', () => {
      const c = setupComponent('/active/tasks');
      expect(c.displayTitle()).toBe('Today');
    });

    it('matches /config#plugins (URL with fragment)', () => {
      const c = setupComponent('/config#plugins');
      expect(c.displayTitle()).toBe(T.PS.GLOBAL_SETTINGS);
    });

    it('matches /config?tab=2 (URL with query params)', () => {
      const c = setupComponent('/config?tab=2');
      expect(c.displayTitle()).toBe(T.PS.GLOBAL_SETTINGS);
    });

    it('updates on navigation', () => {
      const c = setupComponent('/active/tasks');
      expect(c.displayTitle()).toBe('Today');

      routerEvents$.next(new NavigationEnd(1, '/planner', '/planner'));
      expect(c.displayTitle()).toBe(T.MH.PLANNER);

      routerEvents$.next(new NavigationEnd(2, '/config', '/config#plugins'));
      expect(c.displayTitle()).toBe(T.PS.GLOBAL_SETTINGS);
    });
  });

  describe('isSpecialSection()', () => {
    it('is true for /config', () => {
      const c = setupComponent('/config');
      expect(c.isSpecialSection()).toBe(true);
    });

    it('is false for /active/tasks', () => {
      const c = setupComponent('/active/tasks');
      expect(c.isSpecialSection()).toBe(false);
    });

    it('does not collide /scheduled-list with /schedule', () => {
      const c = setupComponent('/scheduled-list');
      expect(c.isSpecialSection()).toBe(true);
      expect(c.displayTitle()).toBe(T.MH.ALL_PLANNED_LIST);
    });
  });

  describe('isWorkViewPage()', () => {
    it('is true for /active/tasks', () => {
      const c = setupComponent('/active/tasks');
      expect(c.isWorkViewPage()).toBe(true);
    });

    it('is true for /project/abc/tasks?focus=1 (with query)', () => {
      const c = setupComponent('/project/abc/tasks?focus=1');
      expect(c.isWorkViewPage()).toBe(true);
    });

    it('is false for /config', () => {
      const c = setupComponent('/config');
      expect(c.isWorkViewPage()).toBe(false);
    });
  });

  describe('layout', () => {
    // Regression test for the bug where a long active-work-context title
    // refused to shrink and pushed the trailing header actions off screen.
    // We render the real component in a constrained-width flex row, then
    // assert observable behavior: the title actually ellipsizes, and the
    // trailing actions stay fully inside the row.
    it('truncates long titles instead of pushing trailing actions off screen', async () => {
      const LONG_TITLE = 'A very long project title '.repeat(20);

      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        providers: [
          {
            provide: Router,
            useValue: { events: new Subject<NavigationEnd>(), url: '/active/tasks' },
          },
          {
            provide: BreakpointObserver,
            useValue: { observe: () => of({ matches: false }) },
          },
          {
            provide: WorkContextService,
            useValue: {
              activeWorkContextTitle$: of(LONG_TITLE),
              activeWorkContextTypeAndId$: of({
                activeId: 'p1',
                activeType: 'PROJECT',
              }),
            },
          },
          {
            provide: TaskViewCustomizerService,
            useValue: { isCustomized: () => false },
          },
          {
            provide: GlobalConfigService,
            useValue: { cfg: () => ({ keyboard: {} }) },
          },
          {
            provide: TranslateService,
            useValue: { instant: (key: string) => key },
          },
        ],
      })
        // Strip Material/Router-dependent children but keep the structural
        // markup (and crucially the component's `styles` array) so that the
        // flex rules under test (`flex: 1 1 auto; min-width: 0;` on
        // `.page-title`, `flex: 0 0 auto;` on `.page-title-actions`) are
        // applied to real DOM nodes.
        .overrideComponent(PageTitleComponent, {
          set: {
            imports: [],
            template: `
              <div class="page-title">{{ displayTitle() }}</div>
              <div class="page-title-actions">
                <button type="button">x</button>
              </div>
            `,
          },
        })
        .compileComponents();

      @Component({
        standalone: true,
        imports: [PageTitleComponent],
        template: `
          <div
            #row
            style="display: flex; align-items: center; width: 220px; box-sizing: border-box;"
          >
            <page-title></page-title>
            <div
              #trailing
              class="trailing-actions"
              style="flex: 0 0 auto; width: 40px;"
            >
              R
            </div>
          </div>
        `,
      })
      class HostComponent {}

      const fixture = TestBed.createComponent(HostComponent);
      // Layout must be computed in the live DOM for width measurements.
      document.body.appendChild(fixture.nativeElement);
      try {
        fixture.detectChanges();

        const row = fixture.nativeElement.firstElementChild as HTMLElement;
        const title = fixture.nativeElement.querySelector('.page-title') as HTMLElement;
        const trailing = fixture.nativeElement.querySelector(
          '.trailing-actions',
        ) as HTMLElement;

        // Title actually overflows its rendered box -> ellipsis is active.
        expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);

        // Trailing actions are still fully contained within the row.
        const rowRect = row.getBoundingClientRect();
        const trailingRect = trailing.getBoundingClientRect();
        expect(trailingRect.right).toBeLessThanOrEqual(rowRect.right + 0.5);
        expect(trailingRect.left).toBeGreaterThanOrEqual(rowRect.left - 0.5);
      } finally {
        document.body.removeChild(fixture.nativeElement);
      }
    });
  });
});
