import {
  Component,
  ElementRef,
  EnvironmentInjector,
  NO_ERRORS_SCHEMA,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EMPTY, of } from 'rxjs';
import { TranslateModule, TranslatePipe, TranslateService } from '@ngx-translate/core';

import { MainHeaderComponent } from './main-header.component';
import { ProjectService } from '../../features/project/project.service';
import { LayoutService } from '../layout/layout.service';
import { TaskService } from '../../features/tasks/task.service';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { SimpleCounterService } from '../../features/simple-counter/simple-counter.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { SnackService } from '../../core/snack/snack.service';
import { Router } from '@angular/router';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { MetricService } from '../../features/metric/metric.service';
import { DateService } from '../../core/date/date.service';
import { UserProfileService } from '../../features/user-profile/user-profile.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { SyncStatus } from '../../op-log/sync-exports';
import {
  SimpleCounter,
  SimpleCounterType,
} from '../../features/simple-counter/simple-counter.model';
import { ConflictJournalService } from '../../op-log/sync/conflict-journal.service';

// Regression test for #7477: in a project view a long title pushed the
// right-side header actions (simple-counter / habit buttons) off screen.
//
// The fix is a CSS-only flex change on `.action-nav-right` in
// main-header.component.scss, so we don't instantiate the real (heavy)
// MainHeaderComponent. Instead we mount a tiny host that pulls in the *real*
// compiled stylesheet via `styleUrls` and reproduces the exact failing flex
// structure: a constrained `.wrapper` row containing a shrinkable title and
// the `.action-nav-right` nav whose `.counters-action-group` children are
// `flex-shrink: 0`. We then assert observable layout rather than CSS strings.
//
// The discriminating rule under test is `.action-nav-right { flex: 0 0 auto }`:
// remove it and the nav shrinks, its non-shrinking buttons overflow, and the
// last button's right edge escapes the row — which is exactly the bug.
@Component({
  standalone: true,
  styleUrls: ['./main-header.component.scss'],
  template: `
    <div
      class="wrapper"
      style="width: 320px; box-sizing: border-box"
    >
      <div
        class="page-title"
        style="
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        "
      >
        {{ title }}
      </div>

      <nav class="action-nav-right">
        <div class="header-action-group secondary-action-group counters-action-group">
          <button type="button"></button>
          <button type="button"></button>
          <button type="button"></button>
          <button type="button"></button>
        </div>
      </nav>
    </div>
  `,
})
class HeaderLayoutHostComponent {
  title = 'A very long active work context title '.repeat(8);
}

describe('MainHeaderComponent layout', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderLayoutHostComponent],
    }).compileComponents();
  });

  it('keeps the action buttons on screen when the title is long (#7477)', () => {
    const fixture = TestBed.createComponent(HeaderLayoutHostComponent);
    // Layout must be computed in the live DOM for width measurements.
    document.body.appendChild(fixture.nativeElement);
    try {
      fixture.detectChanges();

      const wrapper = fixture.nativeElement.querySelector('.wrapper') as HTMLElement;
      const title = fixture.nativeElement.querySelector('.page-title') as HTMLElement;
      const buttons = Array.from(
        fixture.nativeElement.querySelectorAll('.counters-action-group button'),
      ) as HTMLElement[];
      const lastButton = buttons[buttons.length - 1];

      // Sanity: the real stylesheet was applied, so the buttons have width.
      expect(buttons.length).toBe(4);
      expect(lastButton.getBoundingClientRect().width).toBeGreaterThan(0);

      // The title takes the squeeze and ellipsizes...
      expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);

      // ...so the trailing action button stays fully inside the header row.
      const wrapperRect = wrapper.getBoundingClientRect();
      const lastButtonRect = lastButton.getBoundingClientRect();
      expect(lastButtonRect.right).toBeLessThanOrEqual(wrapperRect.right + 0.5);
    } finally {
      document.body.removeChild(fixture.nativeElement);
    }
  });
});

describe('MainHeaderComponent focus button visibility', () => {
  let component: MainHeaderComponent;
  let fixture: ComponentFixture<MainHeaderComponent> | undefined;
  let isXs = signal(false);
  let isXxxs = signal(false);
  let appFeatures = signal(DEFAULT_GLOBAL_CONFIG.appFeatures);
  let enabledSimpleCounters: SimpleCounter[] = [];

  const configureTestBed = (): void => {
    const cfg = {
      ...DEFAULT_GLOBAL_CONFIG,
      appFeatures: appFeatures(),
    };

    TestBed.configureTestingModule({
      imports: [MainHeaderComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: ElementRef,
          useValue: {
            nativeElement: {
              querySelector: () => null,
            },
          },
        },
        { provide: ProjectService, useValue: { getByIdOnce$: () => of(null) } },
        {
          provide: LayoutService,
          useValue: {
            isXs,
            isXxxs,
            isShowIssuePanel: signal(false),
            isShowNotes: signal(false),
            isShowScheduleDayPanel: signal(false),
          },
        },
        {
          provide: TaskService,
          useValue: {
            currentTaskParentOrCurrent$: of(null),
            currentTask$: of(null),
            currentTaskId: signal(null),
          },
        },
        {
          provide: WorkContextService,
          useValue: {
            activeWorkContextId$: of(null),
            undoneTasks$: of([]),
          },
        },
        {
          provide: SimpleCounterService,
          useValue: { enabledSimpleCounters$: of(enabledSimpleCounters) },
        },
        {
          provide: SyncWrapperService,
          useValue: {
            sync: jasmine.createSpy('sync'),
            isEnabledAndReady$: of(false),
            syncState$: of('IN_SYNC'),
            isSyncInProgress$: of(false),
            hasNoPendingOps$: of(true),
            superSyncIsConfirmedInSync$: of(false),
          },
        },
        {
          provide: SnackService,
          useValue: {
            open: jasmine.createSpy('open'),
            hasPendingPersistentAction: jasmine.createSpy('hasPendingPersistentAction'),
          },
        },
        { provide: Router, useValue: { events: EMPTY } },
        {
          provide: GlobalConfigService,
          useValue: {
            cfg$: of(cfg),
            cfg: signal(cfg),
            appFeatures,
            misc: signal({ isVerticalActionBar: false }),
          },
        },
        { provide: MatDialog, useValue: { open: jasmine.createSpy('open') } },
        { provide: Store, useValue: { dispatch: jasmine.createSpy('dispatch') } },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: of(true) },
        },
        { provide: MetricService, useValue: { getFocusSummaryForDay: () => null } },
        { provide: DateService, useValue: { todayStr: () => '2026-06-09' } },
        { provide: UserProfileService, useValue: { isInitialized: () => false } },
        { provide: ConflictJournalService, useValue: { unreviewedCount: signal(0) } },
      ],
    }).overrideComponent(MainHeaderComponent, {
      set: {
        imports: [TranslatePipe],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
  };

  const createComponent = (): MainHeaderComponent => {
    configureTestBed();
    return runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
      return new MainHeaderComponent();
    });
  };

  beforeEach(() => {
    isXs = signal(false);
    isXxxs = signal(false);
    appFeatures = signal(DEFAULT_GLOBAL_CONFIG.appFeatures);
    enabledSimpleCounters = [];
  });

  afterEach(() => {
    component?.ngOnDestroy();
    fixture?.destroy();
  });

  it('keeps the focus mode entry visible on narrow mobile screens (#8157)', () => {
    isXs = signal(true);
    isXxxs = signal(true);
    appFeatures = signal({
      ...DEFAULT_GLOBAL_CONFIG.appFeatures,
      isFocusModeEnabled: true,
    });

    component = createComponent();

    expect(component.showDesktopButtons()).toBe(false);
    expect(component.isFocusButtonVisible()).toBe(true);
  });

  it('hides the focus button when the app feature is disabled', () => {
    appFeatures = signal({
      ...DEFAULT_GLOBAL_CONFIG.appFeatures,
      isFocusModeEnabled: false,
    });

    component = createComponent();

    expect(component.isFocusButtonVisible()).toBe(false);
  });

  it('labels the mobile counter toggle and removes the collapsed menu from interaction', () => {
    isXs = signal(true);
    isXxxs = signal(true);
    enabledSimpleCounters = [
      {
        id: 'counter-1',
        title: 'Stretch',
        isEnabled: true,
        icon: 'fitness_center',
        type: SimpleCounterType.ClickCounter,
        countOnDay: {},
        isOn: false,
      },
    ];

    configureTestBed();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      F: {
        METRIC: {
          CMP: {
            SIMPLE_COUNTERS: 'Simple Counters & Habit Tracking',
          },
        },
      },
    });
    translate.use('en');
    fixture = TestBed.createComponent(MainHeaderComponent);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector(
      '.mobile-dropdown-wrapper > button',
    ) as HTMLButtonElement;
    const menu = fixture.nativeElement.querySelector('.mobile-dropdown') as HTMLElement;

    expect(toggle.getAttribute('aria-label')).toBe('Simple Counters & Habit Tracking');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('mobile-simple-counter-menu');
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(menu.inert).toBe(true);

    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(menu.getAttribute('aria-hidden')).toBe('false');
    expect(menu.inert).toBe(false);
  });

  it('keeps a persistent recovery action instead of showing routine sync success', async () => {
    component = createComponent();
    const syncWrapperService = TestBed.inject(
      SyncWrapperService,
    ) as jasmine.SpyObj<SyncWrapperService>;
    const snackService = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
    syncWrapperService.sync.and.resolveTo(SyncStatus.UpdateRemote);
    snackService.hasPendingPersistentAction.and.returnValue(true);

    component.sync();
    await Promise.resolve();

    expect(snackService.open).not.toHaveBeenCalled();
  });
});
