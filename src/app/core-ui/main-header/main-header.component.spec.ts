import {
  Component,
  ElementRef,
  EnvironmentInjector,
  NO_ERRORS_SCHEMA,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ApplicationRef } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { EMPTY, of } from 'rxjs';
import { TranslateModule, TranslatePipe } from '@ngx-translate/core';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';

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
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { BannerService } from '../../core/banner/banner.service';
import { NavigateToTaskService } from '../navigate-to-task/navigate-to-task.service';
import { FocusModeService } from '../../features/focus-mode/focus-mode.service';

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
// The rule under test used to be `.action-nav-right { flex: 0 0 auto }`. Since
// #9480 the nav has to be shrinkable so that it can scroll as a last resort, so
// the same guarantee is expressed as a shrink *priority* instead: the title
// carries `flex-shrink: 999` and absorbs essentially all of the squeeze before
// the nav gives up a pixel. That declaration lives in page-title.component.ts
// (which owns the title's own flex behaviour, as it owns its `min-width`), and
// this synthetic host mirrors it — it loads only main-header's stylesheet, so
// it cannot inherit it. Drop the priority and both shrink at factor 1, the
// nav's non-shrinking buttons overflow, and the last button escapes the row.
//
// The second assertion covers the #9480 floor itself, which does live in
// main-header.component.scss: even when the row genuinely cannot fit, the nav
// is a scroll container, so no button is ever unreachable.
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
          flex: 1 999 auto;
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

// A row narrower than the actions in it -- the state #9480 was reported for.
// `.main-content` is `overflow: hidden`, so before the row scrolled, an action
// past the trailing edge was simply unreachable. Measured against the real CSS
// this is not a corner: play + add-task + focus + sync plus the title's floor
// stop fitting somewhere under a ~1050px window with the right panel open, and
// at 600-730px with just the default side nav.
@Component({
  standalone: true,
  styleUrls: ['./main-header.component.scss'],
  template: `
    <div
      class="wrapper"
      style="width: 260px; box-sizing: border-box"
    >
      <div
        class="page-title"
        style="flex: 1 999 auto; min-width: 160px; overflow: hidden"
      >
        A project name
      </div>

      <nav class="action-nav-right">
        <div class="action-nav-scroll">
          <button
            type="button"
            style="width: 40px; height: 40px"
          ></button>
          <button
            type="button"
            style="width: 40px; height: 40px"
          ></button>
          <button
            type="button"
            style="width: 40px; height: 40px"
          ></button>
        </div>
      </nav>
    </div>
  `,
})
class OverflowingRowHostComponent {}

// The Electron custom-title-bar reserve. `main-header` keeps the window
// controls clear by padding its own right edge -- but the controls sit in the
// top-right corner of the WINDOW, and with the right panel open that corner
// belongs to the panel. Reserving there anyway cost the action row ~140px it
// did not owe, which measured out at a nav 8px wide: every header action gone,
// overflow trigger included.
//
// `:host-context` resolves against real ancestors, so the host is mounted
// inside a `<right-panel>` the test toggles `isOpen` on, exactly as
// RightPanelComponent's own host binding does.
@Component({
  standalone: true,
  styleUrls: ['./main-header.component.scss'],
  template: `<div class="wrapper"></div>`,
})
class WindowControlsHostComponent {}

// The title keeps enough of its name to stay readable however tight the row
// gets. That is a plain `min-width` on the text now, not a width some solver
// reserves: the row scrolls when it runs out of room, so the floor costs scroll
// rather than a lost button.
//
// The token is pinned on the host rather than inherited from `:host`, because
// its real value lives behind `@include mq(xs)` — a viewport media query, which
// in Karma would make this assert against whatever size the runner's browser
// happens to be. What is under test here is that the floor BINDS and the row
// yields instead; that the desktop value is non-zero is asserted in
// `e2e/tests/navigation/main-header-title.spec.ts`, which controls its viewport.
//
// Mirrors page-title's own text rules inline: this host loads only
// main-header's stylesheet, so it cannot inherit them.
@Component({
  standalone: true,
  styleUrls: ['./main-header.component.scss'],
  template: `
    <div
      class="wrapper"
      style="width: 300px; box-sizing: border-box; --header-title-text-min: 60px"
    >
      <!-- The floor is on the title BOX, not on the span: a flex item with
           overflow hidden may shrink below its content's minimum, so a floor on
           the span alone leaves the text at full width inside a box collapsed to
           its padding, which then clips it. page-title carries the same rule. -->
      <div
        class="page-title"
        style="
          display: flex;
          align-items: center;
          flex: 1 999 auto;
          overflow: hidden;
          font-size: 18px;
          min-width: var(--header-title-text-min, 0px);
        "
      >
        <span
          class="page-title-text"
          style="
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0;
          "
          >Quarterly Planning And Review</span
        >
      </div>

      <nav class="action-nav-right">
        <div class="action-nav-scroll">
          @for (n of buttons; track n) {
            <button
              type="button"
              style="width: 40px; height: 40px"
            ></button>
          }
        </div>
      </nav>
    </div>
  `,
})
class TitleFloorHostComponent {
  readonly buttons = [1, 2, 3, 4, 5, 6];
}

const WINDOW_CONTROL_BODY_CLASSES = ['isElectron', 'isNoMac', 'isObsidianStyleHeader'];

describe('MainHeaderComponent layout', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TranslateModule.forRoot(),
        HeaderLayoutHostComponent,
        OverflowingRowHostComponent,
        WindowControlsHostComponent,
        TitleFloorHostComponent,
      ],
      providers: [
        { provide: Store, useValue: { select: () => EMPTY, dispatch: () => undefined } },
        {
          provide: TaskService,
          useValue: {
            currentTaskId: signal(null),
            currentTask$: EMPTY,
            currentTaskProgress$: EMPTY,
          },
        },
        { provide: NavigateToTaskService, useValue: { navigate: () => undefined } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => EMPTY }) } },
        { provide: MetricService, useValue: { getFocusSummaryForDay: () => null } },
        { provide: DateService, useValue: { todayStr: () => '2026-06-09' } },
        {
          provide: GlobalConfigService,
          useValue: { cfg: signal({ keyboard: {} }), pomodoroConfig: signal({}) },
        },
        {
          provide: FocusModeService,
          useValue: {
            isSessionRunning: signal(false),
            isSessionPaused: signal(false),
            isBreakActive: signal(false),
            isLongBreak: signal(false),
            progress: signal(0),
            timeRemaining: signal(0),
            sessionDuration: signal(0),
            mode: signal(null),
            currentCycle: signal(1),
            focusModeConfig: signal({}),
          },
        },
        { provide: SimpleCounterService, useValue: { enabledSimpleCounters$: EMPTY } },
        {
          provide: GlobalTrackingIntervalService,
          useValue: { tick$: EMPTY, todayDateStr$: of('2026-06-09') },
        },
        { provide: BannerService, useValue: { open: () => undefined } },
      ],
    }).compileComponents();
  });

  it('keeps the title readable by scrolling the actions instead (#9480)', () => {
    const fixture = TestBed.createComponent(TitleFloorHostComponent);
    document.body.appendChild(fixture.nativeElement);
    try {
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const text = host.querySelector('.page-title-text') as HTMLElement;
      const scroller = host.querySelector('.action-nav-scroll') as HTMLElement;
      const floor = parseFloat(
        getComputedStyle(host.querySelector('.wrapper') as HTMLElement).getPropertyValue(
          '--header-title-text-min',
        ),
      );

      // Precondition: the name is longer than the floor and the row is under
      // real pressure, so neither assertion below is trivially true.
      expect(floor).toBeGreaterThan(0);
      expect(text.scrollWidth).toBeGreaterThan(floor);
      expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);

      // The title stops yielding at the floor...
      expect(text.clientWidth).toBeGreaterThanOrEqual(floor - 1);

      // ...and what it refuses to give up comes out of the row, which scrolls
      // rather than dropping a button off an unscrollable edge.
      scroller.scrollLeft = scroller.scrollWidth;
      expect(scroller.scrollLeft).toBeGreaterThan(0);
    } finally {
      document.body.removeChild(fixture.nativeElement);
    }
  });

  it('drops the window-controls reserve while the right panel is open', () => {
    // Setup inside the `try`: these body classes gate real CSS, so leaking them
    // on a throw would silently apply a 140px reserve to every later fixture.
    const panel = document.createElement('right-panel');
    try {
      document.body.appendChild(panel);
      document.body.classList.add(...WINDOW_CONTROL_BODY_CLASSES);
      const fixture = TestBed.createComponent(WindowControlsHostComponent);
      panel.appendChild(fixture.nativeElement);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;

      // Panel closed: the controls are above the header, so the reserve stands.
      expect(parseFloat(getComputedStyle(host).paddingRight)).toBeGreaterThan(0);

      panel.classList.add('isOpen');
      expect(parseFloat(getComputedStyle(host).paddingRight)).toBe(0);
    } finally {
      document.body.classList.remove(...WINDOW_CONTROL_BODY_CLASSES);
      panel.remove();
    }
  });

  it('keeps every action reachable when the row does not fit (#9480)', () => {
    const fixture = TestBed.createComponent(OverflowingRowHostComponent);
    document.body.appendChild(fixture.nativeElement);
    try {
      fixture.detectChanges();

      const wrapper = fixture.nativeElement.querySelector('.wrapper') as HTMLElement;
      const nav = fixture.nativeElement.querySelector('.action-nav-right') as HTMLElement;
      const scroller = fixture.nativeElement.querySelector(
        '.action-nav-scroll',
      ) as HTMLElement;

      // Precondition: the row genuinely cannot fit, so this is the reported
      // case and not a trivially passing setup.
      expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);

      // The nav stays inside the clip edge instead of spilling past it, and the
      // actions really are scrollable rather than merely clipped.
      expect(nav.getBoundingClientRect().right).toBeLessThanOrEqual(
        wrapper.getBoundingClientRect().right + 0.5,
      );
      // The row rests at the inline start, so nothing is stranded left of
      // origin where `scrollLeft` clamps and cannot bring it back.
      expect(scroller.scrollLeft).toBe(0);
      scroller.scrollLeft = scroller.scrollWidth;
      expect(scroller.scrollLeft).toBeGreaterThan(0);
    } finally {
      document.body.removeChild(fixture.nativeElement);
    }
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

      // The clip lives on `.action-nav-scroll`, never on the nav itself, so the
      // nav keeps the ink its badges and elevation paint outside their boxes.
      const nav = fixture.nativeElement.querySelector('.action-nav-right') as HTMLElement;
      expect(getComputedStyle(nav).overflowX).toBe('visible');
    } finally {
      document.body.removeChild(fixture.nativeElement);
    }
  });
});

describe('MainHeaderComponent action placement', () => {
  let component: MainHeaderComponent;
  let fixture: ComponentFixture<MainHeaderComponent> | undefined;
  let isXs = signal(false);
  let isXxxs = signal(false);
  let appFeatures = signal(DEFAULT_GLOBAL_CONFIG.appFeatures);
  let enabledSimpleCounters: SimpleCounter[] = [];
  let isAllDataLoaded = true;
  let pluginHeaderButtons = signal<unknown[]>([]);
  let pluginSidePanelButtons = signal<unknown[]>([]);
  let currentTaskId = signal<string | null>(null);
  let isShowNotes = signal(false);

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
            isShowMobileBottomNav: isXs,
            isShowIssuePanel: signal(false),
            isShowNotes,
            isShowScheduleDayPanel: signal(false),
            isShowPluginPanel: signal(false),
            activePluginId: signal(null),
          },
        },
        {
          provide: PluginBridgeService,
          useValue: {
            headerButtons: pluginHeaderButtons,
            workContextHeaderButtons: signal([]),
            sidePanelButtons: pluginSidePanelButtons,
          },
        },
        {
          provide: TaskService,
          useValue: {
            currentTaskParentOrCurrent$: of(null),
            currentTask$: of(null),
            currentTaskId,
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
          useValue: { isAllDataLoadedInitially$: isAllDataLoaded ? of(true) : EMPTY },
        },
        { provide: MetricService, useValue: { getFocusSummaryForDay: () => null } },
        { provide: DateService, useValue: { todayStr: () => '2026-06-09' } },
        { provide: UserProfileService, useValue: { isInitialized: () => false } },
        { provide: ConflictJournalService, useValue: { unreviewedCount: signal(0) } },
        {
          provide: FocusModeService,
          useValue: {
            isSessionRunning: signal(false),
            isSessionPaused: signal(false),
            isBreakActive: signal(false),
          },
        },
        // `createComponent()` builds the component outside a component
        // injector, where no host element exists. The specs that use it only
        // read placement rules, so an unattached element is enough.
        { provide: ElementRef, useValue: new ElementRef(document.createElement('div')) },
      ],
    }).overrideComponent(MainHeaderComponent, {
      set: {
        // NgTemplateOutlet is real, not stubbed: the sync button is mounted
        // through it, and a stubbed outlet would leave the sync slot empty.
        imports: [TranslatePipe, NgTemplateOutlet],
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
    isAllDataLoaded = true;
    pluginHeaderButtons = signal<unknown[]>([]);
    pluginSidePanelButtons = signal<unknown[]>([]);
    currentTaskId = signal<string | null>(null);
    isShowNotes = signal(false);
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

    // The add button lives in the bottom nav's FAB on mobile, not the header.
    expect(component.hasBottomNav()).toBe(true);
    expect(component.isFocusModeEnabled()).toBe(true);
  });

  it('hides the focus button when the app feature is disabled', () => {
    appFeatures = signal({
      ...DEFAULT_GLOBAL_CONFIG.appFeatures,
      isFocusModeEnabled: false,
    });

    component = createComponent();

    expect(component.isFocusModeEnabled()).toBe(false);
  });

  // These mount the real component into the live DOM at a fixed width and let
  // the browser lay it out. Nothing here fakes a width any more: the fit adds
  // the row up from how many buttons each action contributes, and those counts
  // come from the same stubbed services production reads, so the only input the
  // test controls is how much room the header gets. Earlier versions injected a
  // width per slot because the fit measured them — and every one of the bugs
  // #9480 went through was that injected number disagreeing with the CSS.
  let box: HTMLElement | undefined;

  const mountAtWidth = async (width: number): Promise<HTMLElement> => {
    configureTestBed();
    fixture = TestBed.createComponent(MainHeaderComponent);
    const host = fixture.nativeElement as HTMLElement;
    box = document.createElement('div');
    box.style.width = `${width}px`;
    document.body.appendChild(box);
    box.appendChild(host);
    await settle();
    return host;
  };

  /**
   * Let the fit settle. It is a `computed()`, so there is nothing to wait out —
   * only the width that feeds it, which arrives from a ResizeObserver. The
   * reflow this replaced needed twelve turns of a 20ms timer: one per demotable
   * action, plus the 120ms a widening spent waiting before it dared re-offer
   * anything.
   */
  const settle = async (): Promise<void> => {
    // Two frames, not a sleep: ResizeObserver callbacks are delivered after
    // layout and before paint, so a frame having passed is a guarantee rather
    // than a guess — and a slow CI box cannot turn a timing assumption into a
    // failure.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    TestBed.inject(ApplicationRef).tick();
    await fixture!.whenStable();
  };

  afterEach(() => {
    box?.remove();
    box = undefined;
  });

  it('leaves the bottom nav its own actions, below 600px', async () => {
    // One action, one home. The nav's panels menu lists the plugin side-panel
    // buttons and the three desktop panel toggles, so the header must not
    // render them as well -- rendering both put the same plugin button in two
    // places on a phone at once. The other end of the rule (a header slot
    // hidden without the menu listing it) is pinned by
    // `mobile-bottom-nav.component.spec`.
    const btn = { label: 'x', icon: 'x', onClick: () => {} };
    isXs = signal(true);
    pluginSidePanelButtons = signal<unknown[]>([btn]);

    const host = await mountAtWidth(404);

    expect(host.querySelector('plugin-side-panel-btns')).toBeFalsy();
    expect(host.querySelector('desktop-panel-buttons')).toBeFalsy();
    expect(host.querySelector('.tour-addBtn')).toBeFalsy();
  });

  it('keeps every action in the row above 600px', async () => {
    // The complement of the rule above: with the bottom nav gone, the header is
    // where all three live again.
    const btn = { label: 'x', icon: 'x', onClick: () => {} };
    pluginSidePanelButtons = signal<unknown[]>([btn]);

    const host = await mountAtWidth(1400);

    expect(host.querySelector('plugin-side-panel-btns')).toBeTruthy();
    expect(host.querySelector('desktop-panel-buttons')).toBeTruthy();
    expect(host.querySelector('.tour-addBtn')).toBeTruthy();
  });

  it('scrolls the actions and never the nav, at any width (#9480)', async () => {
    // The row is a scroll container unconditionally -- there is no width at
    // which an action can run off an edge nothing can scroll back, which is what
    // the reporter asked for: "scrollable or otherwise accessible".
    //
    // The clip lives on the inner box, never on the nav, so the nav keeps the
    // ink its badges and elevation paint outside their boxes. 1400px is the case
    // that regressed once: the scroller used to be `display: contents` -- not a
    // box at all -- until a floor engaged.
    const host = await mountAtWidth(1400);
    const nav = host.querySelector('nav.action-nav-right') as HTMLElement;
    const scroller = host.querySelector('.action-nav-scroll') as HTMLElement;

    expect(getComputedStyle(scroller).overflowX).toBe('auto');
    expect(getComputedStyle(nav).overflowX).toBe('visible');
  });

  it('costs the row nothing for the ink its clip buys back', async () => {
    // The scroller pads its block axis so badges, the active-panel underline
    // and the play button's elevation still paint once the box clips, and
    // cancels that padding with an equal negative margin so the row's own
    // height is untouched. The inline END is deliberately unpadded: cancelling
    // padding there needs a negative end margin, which would let this box paint
    // outside the header's own edge.
    const host = await mountAtWidth(1400);
    const scroller = host.querySelector('.action-nav-scroll') as HTMLElement;
    const cs = getComputedStyle(scroller);

    expect(parseFloat(cs.paddingBlockStart) + parseFloat(cs.marginBlockStart)).toBe(0);
    expect(parseFloat(cs.paddingBlockEnd) + parseFloat(cs.marginBlockEnd)).toBe(0);
    expect(parseFloat(cs.paddingInlineStart) + parseFloat(cs.marginInlineStart)).toBe(0);
    expect(parseFloat(cs.paddingInlineEnd)).toBe(0);
    expect(parseFloat(cs.marginInlineEnd)).toBe(0);
  });

  it('keeps the add-task button in the row however little room is left', async () => {
    // Where there is no bottom-nav FAB the header button is the only
    // quick-capture entry point on the page, so it stays in the row at every
    // width above the breakpoint -- scrolled to, if it comes to that, never
    // dropped.
    const host = await mountAtWidth(220);

    const addBtn = host.querySelector('.tour-addBtn');
    expect(addBtn).toBeTruthy();
    expect(host.querySelector('.action-nav-scroll')!.contains(addBtn)).toBe(true);
  });

  // The reveal rules: the row keeps whatever scroll it was left with, so the
  // two moments that MAKE an off-screen control the relevant one scroll it
  // back on screen — a tracking change reveals the play button at the start,
  // a panel open reveals the toggle that closes it at the end. The real
  // stubbed-out buttons render no width here, so the overflow the reveal
  // reacts to is faked onto the scroller and the scroll itself is spied.
  const fakeOverflowAndSpy = (host: HTMLElement): jasmine.Spy => {
    const scroller = host.querySelector('.action-nav-scroll') as HTMLElement;
    Object.defineProperty(scroller, 'scrollWidth', { value: 500, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 200, configurable: true });
    return spyOn(scroller, 'scrollTo');
  };

  it('returns the row to its start when tracking starts', async () => {
    // A running timer's pause control behind the start edge is the worst
    // hidden action the row can have: the start fade may land on the group
    // gap and say nothing at all.
    const host = await mountAtWidth(1400);
    const scrollTo = fakeOverflowAndSpy(host);

    currentTaskId.set('task-1');
    await settle();

    expect(scrollTo).toHaveBeenCalledWith(jasmine.objectContaining({ left: 0 }));
  });

  it('keeps the toggle that closes a panel on screen when it opens', async () => {
    // Opening a panel shrinks the row, which pushes the very button just
    // clicked — last in DOM order — behind the trailing edge.
    const host = await mountAtWidth(1400);
    const scrollTo = fakeOverflowAndSpy(host);

    isShowNotes.set(true);
    await settle();

    expect(scrollTo).toHaveBeenCalledWith(jasmine.objectContaining({ left: 300 }));
  });

  it('returns the row to rest when the panel closes', async () => {
    const host = await mountAtWidth(1400);
    const scrollTo = fakeOverflowAndSpy(host);

    isShowNotes.set(true);
    await settle();
    scrollTo.calls.reset();

    isShowNotes.set(false);
    await settle();

    expect(scrollTo).toHaveBeenCalledWith(jasmine.objectContaining({ left: 0 }));
  });

  it('leaves the row alone when the bottom nav owns the panel toggles', async () => {
    // Below 600px the panel opens as a bottom sheet and its toggles live in
    // the bottom nav — there is nothing at the row's end to reveal.
    isXs = signal(true);
    const host = await mountAtWidth(404);
    const scrollTo = fakeOverflowAndSpy(host);

    isShowNotes.set(true);
    await settle();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not move the row for the boot state', async () => {
    // A panel restored open (or a task already tracking) at boot is not a
    // user action; the row must come up at rest, not mid-reveal.
    currentTaskId = signal<string | null>('task-1');
    isShowNotes = signal(true);
    const host = await mountAtWidth(1400);
    const scrollTo = fakeOverflowAndSpy(host);

    // A boot-time reveal would fire during mount, before the spy exists, and
    // against real geometry it scrolls nothing — what it leaves behind is a
    // live 400ms pin. Resize the SCROLLER itself (its box is content-sized,
    // so resizing the host box around it does not move it) to make the
    // ResizeObserver re-apply that pin against the faked overflow, where the
    // spy catches it; without this the test passes even with the first-run
    // guard removed.
    const scroller = host.querySelector('.action-nav-scroll') as HTMLElement;
    scroller.style.width = '150px';
    await settle();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('shows the add-task button before initial data load finishes', () => {
    // The shell paints before op-log hydration completes; the quick-capture
    // entry point must already be there in that window, while the
    // data-dependent header parts still wait for the data-loaded signal.
    isAllDataLoaded = false;

    configureTestBed();
    fixture = TestBed.createComponent(MainHeaderComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.tour-addBtn')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('page-title')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('.counters-action-group')).toBeFalsy();
  });

  // --- Collapsed counters below 600px -------------------------------------
  // Counters are the one group the app does not bound -- a user may define any
  // number -- so on a phone they are the only action that can push the row into
  // a long scroll on its own. Above the breakpoint they stay inline, because the
  // readout on the button face is what a counter is for.

  const counter = (id: string, over: Partial<SimpleCounter> = {}): SimpleCounter => ({
    id,
    title: id,
    isEnabled: true,
    icon: null,
    type: SimpleCounterType.ClickCounter,
    countOnDay: {},
    isOn: false,
    ...over,
  });

  it('collapses the counters behind one trigger below 600px', async () => {
    isXs = signal(true);
    enabledSimpleCounters = [counter('a'), counter('b')];

    const host = await mountAtWidth(404);

    // Not inline...
    expect(
      host.querySelectorAll('.counters-action-group simple-counter-button').length,
    ).toBe(0);
    // ...but all of them still mounted, inside the tray. They own their
    // countdown-completion subscription, so a counter that existed only while
    // the tray was open would stop firing reminders.
    expect(
      host.querySelectorAll('#mobile-simple-counter-menu simple-counter-button').length,
    ).toBe(2);
    // Outside the scroller, or `overflow-x: auto` would clip the tray to the
    // row's own height and the trigger would scroll away from a running counter.
    const wrapper = host.querySelector('.mobile-dropdown-wrapper');
    expect(wrapper).toBeTruthy();
    expect(host.querySelector('.action-nav-scroll')!.contains(wrapper)).toBe(false);
  });

  it('keeps the counters inline above 600px', async () => {
    enabledSimpleCounters = [counter('a'), counter('b')];

    const host = await mountAtWidth(1400);

    expect(
      host.querySelectorAll('.counters-action-group simple-counter-button').length,
    ).toBe(2);
    expect(host.querySelector('.mobile-dropdown-wrapper')).toBeFalsy();
  });

  it('offers no trigger when every counter hides its button', async () => {
    // A trigger opening an empty tray is worse than no trigger: `length` alone
    // would have offered one.
    isXs = signal(true);
    enabledSimpleCounters = [counter('a', { isHideButton: true })];

    const host = await mountAtWidth(404);

    expect(host.querySelector('.mobile-dropdown-wrapper')).toBeFalsy();
  });

  it('does not leave the tray open behind a trigger that is gone', async () => {
    // Widening removes the trigger, so the open flag must not outlive it --
    // otherwise the tray springs open by itself the next time the window
    // narrows, with nothing on screen to close it.
    isXs = signal(true);
    enabledSimpleCounters = [counter('a')];

    await mountAtWidth(404);
    fixture!.componentInstance.isShowSimpleCounterBtnsDropdown.set(true);
    expect(fixture!.componentInstance.isShowSimpleCounterBtnsDropdown()).toBe(true);

    isXs.set(false);
    await settle();
    expect(fixture!.componentInstance.hasCounterDropdown()).toBe(false);

    isXs.set(true);
    await settle();
    expect(fixture!.componentInstance.isShowSimpleCounterBtnsDropdown()).toBe(false);
  });

  it('accents the trigger while a collapsed counter is running', async () => {
    // The trigger is the only thing on screen that can say a counter is still
    // going once they are behind it.
    isXs = signal(true);
    enabledSimpleCounters = [counter('a', { isOn: true })];

    await mountAtWidth(404);

    expect(fixture!.componentInstance.isAnyCounterRunning()).toBe(true);
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
