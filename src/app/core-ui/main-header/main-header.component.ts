import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ProjectService } from '../../features/project/project.service';
import { LayoutService } from '../layout/layout.service';
import { TaskService } from '../../features/tasks/task.service';
import { T } from '../../t.const';
import { filter, map, switchMap } from 'rxjs/operators';
import { of, Subscription } from 'rxjs';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { SimpleCounterService } from '../../features/simple-counter/simple-counter.service';
import { SimpleCounter } from '../../features/simple-counter/simple-counter.model';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { SnackService } from '../../core/snack/snack.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { KeyboardConfig, keyboardConfigOrEmpty } from '@sp/keyboard-config';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatBadge } from '@angular/material/badge';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { SimpleCounterButtonComponent } from '../../features/simple-counter/simple-counter-button/simple-counter-button.component';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { LongPressDirective } from '../../ui/longpress/longpress.directive';
import { isOnline$ } from '../../util/is-online';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { SyncStatus } from '../../op-log/sync-exports';
import { PluginHeaderBtnsComponent } from '../../plugins/ui/plugin-header-btns.component';
import { PluginWorkContextHeaderBtnsComponent } from '../../plugins/ui/plugin-work-context-header-btns.component';
import { PluginSidePanelBtnsComponent } from '../../plugins/ui/plugin-side-panel-btns.component';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { PageTitleComponent } from './page-title/page-title.component';
import { PlayButtonComponent } from './play-button/play-button.component';
import { TrackedTaskPillComponent } from './tracked-task-pill/tracked-task-pill.component';
import { DesktopPanelButtonsComponent } from './desktop-panel-buttons/desktop-panel-buttons.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { UserProfileButtonComponent } from '../../features/user-profile/user-profile-button/user-profile-button.component';
import { FocusButtonComponent } from './focus-button/focus-button.component';
import { EmlDropDirective } from '../../core/drop-paste-input/eml-drop.directive';
import { ConflictJournalService } from '../../op-log/sync/conflict-journal.service';
import { UserProfileService } from '../../features/user-profile/user-profile.service';

/** One `DOM_DELTA_LINE` notch, in CSS pixels. Matches the row's icon metrics. */
const WHEEL_LINE_HEIGHT_PX = 16;

/**
 * How long a reveal keeps re-asserting its edge while the row's own box is
 * still changing under it, in ms. Covers the right panel's 225ms width
 * animation (ANI_ENTER_TIMING) with margin; once it passes, the scroll
 * position belongs to the user again.
 */
const ACTION_ROW_REVEAL_PIN_MS = 400;

@Component({
  selector: 'main-header',
  templateUrl: './main-header.component.html',
  styleUrls: ['./main-header.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconButton,
    MatIcon,
    MatBadge,
    MatTooltip,
    TranslatePipe,
    SimpleCounterButtonComponent,
    LongPressDirective,
    EmlDropDirective,
    PluginHeaderBtnsComponent,
    PluginWorkContextHeaderBtnsComponent,
    PluginSidePanelBtnsComponent,
    CdkScrollable,
    PageTitleComponent,
    PlayButtonComponent,
    TrackedTaskPillComponent,
    DesktopPanelButtonsComponent,
    UserProfileButtonComponent,
    FocusButtonComponent,
  ],
})
export class MainHeaderComponent implements OnDestroy {
  private readonly _elRef = inject(ElementRef<HTMLElement>);
  private readonly _destroyRef = inject(DestroyRef);
  private _teleportedNav: HTMLElement | null = null;
  private _teleportObserver: MutationObserver | null = null;
  readonly projectService = inject(ProjectService);
  readonly matDialog = inject(MatDialog);
  readonly workContextService = inject(WorkContextService);
  readonly taskService = inject(TaskService);
  readonly layoutService = inject(LayoutService);
  readonly simpleCounterService = inject(SimpleCounterService);
  readonly syncWrapperService = inject(SyncWrapperService);
  readonly globalConfigService = inject(GlobalConfigService);
  private readonly _snackService = inject(SnackService);
  private readonly _configService = inject(GlobalConfigService);
  private readonly _dataInitStateService = inject(DataInitStateService);
  private readonly _conflictJournal = inject(ConflictJournalService);
  private readonly _userProfileService = inject(UserProfileService);

  readonly isDataLoaded = toSignal(this._dataInitStateService.isAllDataLoadedInitially$, {
    initialValue: false,
  });

  // SPAP-15: persistent badge on the sync icon — count of unreviewed
  // auto-resolved sync conflicts awaiting review.
  readonly unreviewedConflictCount = this._conflictJournal.unreviewedCount;

  T: typeof T = T;

  isXs = this.layoutService.isXs;

  private _currentTaskContext$ = this.taskService.currentTaskParentOrCurrent$.pipe(
    filter((ct) => !!ct),
    switchMap((currentTask) =>
      this.workContextService.activeWorkContextId$.pipe(
        filter((activeWorkContextId) => !!activeWorkContextId),
        switchMap((activeWorkContextId) => {
          if (
            currentTask.projectId === activeWorkContextId ||
            currentTask.tagIds.includes(activeWorkContextId as string)
          ) {
            return of(null);
          }
          return currentTask.projectId
            ? this.projectService.getByIdOnce$(currentTask.projectId)
            : of(null);
        }),
      ),
    ),
  );

  currentTaskContext = toSignal(this._currentTaskContext$);

  // Convert more observables to signals

  currentTask = toSignal(this.taskService.currentTask$);
  currentTaskId = this.taskService.currentTaskId;
  enabledSimpleCounters = toSignal(this.simpleCounterService.enabledSimpleCounters$, {
    initialValue: [],
  });
  isShowIssuePanel = this.layoutService.isShowIssuePanel;
  isShowNotes = this.layoutService.isShowNotes;
  isShowScheduleDayPanel = this.layoutService.isShowScheduleDayPanel;

  /**
   * Which right-panel content is open, as one comparable key.
   *
   * Drives the action-row reveal: a change means the user opened, switched or
   * closed a panel whose toggle lives at the row's end. The task-detail panel
   * is deliberately absent — it opens from the task list, not from a header
   * toggle, so there is nothing in the row to reveal for it. One known edge:
   * selecting a task WHILE e.g. notes is open dispatches
   * `hideNonTaskSidePanelContent`, so this key reads NOTES → null and the row
   * returns to rest even though the panel itself stays open (now showing the
   * task). Cosmetic motion only — no control becomes unreachable — and
   * "reveal start on select" is arguably right anyway, so it is left as is.
   */
  private readonly _activePanelKey = computed<string | null>(() => {
    if (this.isShowNotes()) {
      return 'NOTES';
    }
    if (this.isShowIssuePanel()) {
      return 'ISSUES';
    }
    if (this.isShowScheduleDayPanel()) {
      return 'SCHEDULE';
    }
    if (this.layoutService.isShowPluginPanel()) {
      return `PLUGIN:${this.layoutService.activePluginId()}`;
    }
    return null;
  });
  syncIsEnabledAndReady = toSignal(this.syncWrapperService.isEnabledAndReady$);
  syncState = toSignal(this.syncWrapperService.syncState$);
  isSyncInProgress = toSignal(this.syncWrapperService.isSyncInProgress$);
  hasNoPendingOps = toSignal(this.syncWrapperService.hasNoPendingOps$, {
    initialValue: false,
  });
  superSyncIsConfirmedInSync = toSignal(
    this.syncWrapperService.superSyncIsConfirmedInSync$,
    { initialValue: false },
  );
  isOnline = toSignal(isOnline$);
  // State-aware tooltip for the sync button: the icon alone (sync_problem /
  // wifi_off) signals a problem but never explains it. Surfacing the state in
  // the tooltip is the ambient counterpart to suppressing the transient
  // network snack on automatic syncs — a persistent problem stays discoverable
  // by glancing at / hovering the always-present header button.
  // Precedence mirrors the icon @if cascade in the template (disabled →
  // offline → error → syncing → in-sync); keep the two in sync.
  syncTooltip = computed(() => {
    if (!this.syncIsEnabledAndReady()) {
      return T.MH.TRIGGER_SYNC;
    }
    if (!this.isOnline()) {
      return T.MH.SYNC_STATE.OFFLINE;
    }
    if (this.syncState() === 'ERROR') {
      return T.MH.SYNC_STATE.ERROR;
    }
    if (this.isSyncInProgress()) {
      return T.MH.SYNC_STATE.SYNCING;
    }
    if (this.hasNoPendingOps()) {
      return T.MH.SYNC_STATE.IN_SYNC;
    }
    return T.MH.TRIGGER_SYNC;
  });
  readonly isTimeTrackingEnabled = computed(() => {
    return this.globalConfigService.appFeatures().isTimeTrackingEnabled;
  });
  // Keep the focus entry point visible on mobile too when the feature is enabled.
  // Otherwise Android users can only discover focus mode by rotating to a wider layout (#8157).
  readonly isFocusModeEnabled = computed(
    () => this.globalConfigService.appFeatures().isFocusModeEnabled,
  );
  readonly isSyncIconEnabled = computed(
    () => this.globalConfigService.appFeatures().isSyncIconEnabled,
  );
  readonly isUserProfilesEnabled = computed(
    () =>
      this.globalConfigService.appFeatures().isEnableUserProfiles &&
      this._userProfileService.isInitialized(),
  );

  /**
   * Add-task, the desktop panel buttons and the plugin side-panel buttons are
   * absent below 600px rather than squeezed: the bottom nav owns all three
   * there, via its FAB and its panels menu. That is a placement rule, not a
   * question of width, so it keys off the same signal that decides whether the
   * bottom nav renders at all.
   *
   * One action, one home. Both ends of getting this wrong are bugs, and both
   * have been shipped: hiding a header slot the nav does NOT list drops the
   * action with no trigger to say where it went (the panels menu was missing
   * Schedule), while keeping one the nav DOES list renders the same plugin
   * button in the header and the menu at once. `mobile-bottom-nav.component.spec`
   * pins every panel the menu must list, which is the half that is easy to
   * forget.
   */
  readonly hasBottomNav = this.layoutService.isShowMobileBottomNav;

  /**
   * Counters collapse behind one button below 600px.
   *
   * The one group whose length the app does not bound — a user may define any
   * number — so on a phone it is the only thing that can push the row into a
   * long scroll on its own. Everything else in the row is a fixed set.
   *
   * Keyed off `isXs` rather than `hasBottomNav`, which happens to be the same
   * signal today: the panel buttons key off the nav because they *move into*
   * it, whereas this is a header-width decision and the counters stay in the
   * header. Same breakpoint, different reason.
   *
   * Gated on a counter that actually renders, not on `length`: a set of
   * counters all carrying `isHideButton` would otherwise put a trigger on the
   * row that opens an empty tray.
   */
  readonly hasCounterDropdown = computed(
    () => this.isXs() && this.enabledSimpleCounters().some((c) => !c.isHideButton),
  );

  /**
   * Whether the tray is open. Reset when the trigger goes away — see the effect
   * in the constructor, which is what enforces that.
   */
  readonly isShowSimpleCounterBtnsDropdown = signal(false);

  /**
   * Accent the trigger while a collapsed counter is still running.
   *
   * Same `!isHideButton` filter the tray itself renders through, or a running
   * hidden counter accents a trigger whose tray contains nothing that explains
   * the accent.
   */
  readonly isAnyCounterRunning = computed(() =>
    this.enabledSimpleCounters().some((c) => c.isOn && !c.isHideButton),
  );

  // Check if there are any undone tasks that can be tracked
  private readonly _hasTrackableTasks$ = this.workContextService.undoneTasks$.pipe(
    map((tasks) => tasks.length > 0),
  );
  hasTrackableTasks = toSignal(this._hasTrackableTasks$, { initialValue: true });

  private _subs: Subscription = new Subscription();

  // Vertical action bar is desktop-only and opt-in via misc config.
  private readonly _isVerticalActionBar = computed(
    () => !this.isXs() && !!this.globalConfigService.misc()?.isVerticalActionBar,
  );

  private readonly _actionScroll =
    viewChild.required<ElementRef<HTMLElement>>('actionScroll');

  /**
   * Whether there is more action row past the scroller's trailing edge.
   *
   * Drives the fade, and nothing else -- the row is a scroll container at every
   * width, so no layout decision hangs off this. False both when the row fits
   * and when it has already been scrolled to the end, so the fade only ever
   * means "there is more that way".
   *
   * The 2px slop matters: several actions paint outside their own box (the sync
   * badge, the active-panel underline, the play button's elevation), and before
   * the scroller's inline padding was made symmetric a clipped badge on the last
   * button kept `scrollWidth` permanently above `clientWidth`.
   */
  readonly canScrollFurther = signal(false);

  /**
   * Whether there is row behind the scroller's leading edge.
   *
   * The mirror of `canScrollFurther`, and it has to exist for the same reason:
   * with the scrollbar hidden, a fade is the only thing that says "there is more
   * that way", and a row scrolled to its end has content hidden at the START
   * with nothing on screen saying so. Nothing ever returns the row to rest, so
   * that state persists across route changes -- and the play button is first in
   * DOM order, so it is the first thing to go behind this edge.
   */
  readonly canScrollBack = signal(false);

  onActionScroll(): void {
    const el = this._actionScroll().nativeElement;
    // `scrollLeft` is negative in RTL on Chromium, so measure the distance
    // travelled rather than the coordinate.
    const travelled = Math.abs(el.scrollLeft);
    this.canScrollFurther.set(travelled + el.clientWidth < el.scrollWidth - 2);
    this.canScrollBack.set(travelled > 2);
  }

  /**
   * The edge the row was last asked to reveal, pinned briefly.
   *
   * A reveal cannot be a single scroll: opening a panel *shrinks* the row over
   * a 225ms width animation, so a scroll issued the moment the state flips is
   * computed against a box that is still narrowing — the end it reaches is not
   * where the end will be. The ResizeObserver that already watches the
   * scroller re-applies the pending reveal on every size change until the
   * deadline passes, which rides the animation instead of guessing its exact
   * duration. The deadline is what hands the row back to the user: a resize
   * later than this (a window drag, a panel resize) must not fight them.
   */
  private _pendingReveal: { edge: 'start' | 'end'; until: number } | null = null;

  /**
   * Guards `_actionScroll()` in code paths that can run without a view: the
   * reveal effects fire on signal changes, and `viewChild.required` throws
   * until the template has rendered. Set in the same `afterNextRender` that
   * wires up the ResizeObserver, whose first callback applies anything a
   * pre-render effect left pending.
   */
  private _isViewReady = false;

  /**
   * Scroll the row so the named edge is on screen, and keep it there while the
   * row's own box is still animating (see `_pendingReveal`).
   *
   * Only the tracking reveal actually glides: nothing resizes the row there, so
   * this smooth scroll is the whole motion. On a panel open the first
   * ResizeObserver tick supersedes it ~17ms later and every frame after that is
   * the instant path, which is what makes the row track the panel exactly one
   * frame behind instead of easing toward a target that keeps moving. Traced at
   * 900px: scrollLeft 0 -> 202 over 12 frames, converging as the panel stops.
   */
  private _reveal(edge: 'start' | 'end'): void {
    this._pendingReveal = { edge, until: Date.now() + ACTION_ROW_REVEAL_PIN_MS };
    this._applyPendingReveal('smooth');
  }

  private _applyPendingReveal(behavior: ScrollBehavior): void {
    const pending = this._pendingReveal;
    if (!pending || !this._isViewReady) {
      return;
    }
    if (Date.now() > pending.until) {
      this._pendingReveal = null;
      return;
    }
    const el = this._actionScroll().nativeElement;
    const maxScroll = el.scrollWidth - el.clientWidth;
    // Nothing hidden: the row fits, or this is the vertical rail, where the
    // scroller is `display: contents` and has no scrollable geometry.
    if (maxScroll <= 0) {
      return;
    }
    // RTL runs `scrollLeft` from 0 down to -max (see onActionWheel).
    const towardsEnd = document.documentElement.dir === 'rtl' ? -1 : 1;
    const left = pending.edge === 'start' ? 0 : towardsEnd * maxScroll;
    el.scrollTo({
      left,
      behavior: this._prefersReducedMotion() ? 'auto' : behavior,
    });
  }

  private _prefersReducedMotion(): boolean {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /**
   * Let a plain wheel scroll the row.
   *
   * A vertical wheel does nothing to a horizontal-only scroller, so on a mouse
   * the fade was pointing at a gesture -- shift+wheel -- that most people do not
   * know. Trackpad, touch and keyboard already reached everything; this is the
   * mouse's share of #9480, and without it the fade is a hint with no move
   * behind it.
   *
   * `deltaX` is left alone: a trackpad or a tilt wheel already scrolls this box,
   * and the platform does that better than we would.
   */
  onActionWheel(ev: WheelEvent): void {
    if (ev.deltaX !== 0) {
      return;
    }
    const el = this._actionScroll().nativeElement;
    // Zero in the vertical rail, where this box is `display: contents` and has
    // no scrollable geometry at all.
    if (el.scrollWidth - el.clientWidth <= 0) {
      return;
    }
    // RTL runs `scrollLeft` from 0 down to -max on Chromium, so "further into
    // the row" is the other direction there. Read off the document rather than
    // via `getComputedStyle`, which forces a style recalc on a listener that
    // fires at trackpad rates. Same source of truth: `app.component` sets `dir`
    // on the document element, which is what the computed value reflected.
    const towardsEnd = document.documentElement.dir === 'rtl' ? -1 : 1;
    const step = towardsEnd * this._wheelDeltaPx(ev, el.clientWidth);
    const before = el.scrollLeft;
    el.scrollLeft = before + step;
    // Only swallow the gesture if it actually moved the row, so a wheel at
    // either end still behaves like an ordinary wheel over the header.
    if (el.scrollLeft !== before) {
      ev.preventDefault();
    }
  }

  /**
   * `deltaY` in CSS pixels, whatever unit the browser reported it in.
   *
   * Only `DOM_DELTA_PIXEL` is already pixels. Firefox reports `DOM_DELTA_LINE`
   * for a classic mouse wheel -- about ±3 per notch -- so taking `deltaY` raw
   * moves the row 3px and then `preventDefault()`s, which reads as broken
   * rather than absent. `DOM_DELTA_PAGE` is reachable from the Windows
   * "one screen at a time" setting.
   */
  private _wheelDeltaPx(ev: WheelEvent, clientWidth: number): number {
    if (ev.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      return ev.deltaY * WHEEL_LINE_HEIGHT_PX;
    }
    if (ev.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      return ev.deltaY * clientWidth;
    }
    return ev.deltaY;
  }

  constructor() {
    /**
     * Widening past 600px removes the trigger, so the open flag must not
     * outlive it — or the tray springs open by itself the next time the window
     * narrows, with nothing on screen to close it. (Master had no such reset:
     * rotating to landscape and back reopened it.)
     *
     * An effect rather than a `linkedSignal` off `hasCounterDropdown`, because
     * this has to survive a round trip. A linked computation only runs when
     * something reads it, and the template reads this flag *only* while the
     * trigger exists — so mobile → desktop → mobile never evaluates it in the
     * one state that would clear it, and it comes back still open.
     */
    effect(() => {
      if (!this.hasCounterDropdown()) {
        this.isShowSimpleCounterBtnsDropdown.set(false);
      }
    });

    // Teleport the action nav to document.body (and back) so the fixed
    // vertical strip escapes any ancestor containing-block
    // (transform/filter/contain) and reliably anchors to the viewport.
    // Reacts live to the config toggle and the desktop/mobile breakpoint;
    // also re-runs when data load fills in the nav's gated content (the nav
    // shell itself renders from first paint).
    effect(() => {
      const enabled = this._isVerticalActionBar();
      this.isDataLoaded();
      this._syncTeleport(enabled);
    });

    /**
     * Reveal the play button when tracking starts, stops or switches task.
     *
     * The row keeps whatever scroll the user (or a Tab-through) left it with,
     * so a running timer's pause control can sit behind the start edge — where
     * the fade may have no ink to say so (the band next to it is the group
     * gap). A tracking change is the one moment the play button is what the
     * user is acting on, so the row glides back to rest and shows it.
     *
     * `undefined` is the first-run sentinel: the boot value must not move the
     * row (and a remote-synced tracking change later merely returns it to
     * rest, which is harmless).
     */
    let prevTrackedId: string | null | undefined;
    effect(() => {
      const trackedId = this.currentTaskId() ?? null;
      const isFirstRun = prevTrackedId === undefined;
      const isChanged = trackedId !== prevTrackedId;
      prevTrackedId = trackedId;
      if (isFirstRun || !isChanged) {
        return;
      }
      untracked(() => this._reveal('start'));
    });

    /**
     * Keep the toggle that closes a panel on screen.
     *
     * Opening a panel shrinks the row, which pushes the very button just
     * clicked — last in DOM order — behind the trailing edge, leaving the
     * panel with no visible header control to close it. So an open or switch
     * reveals the row's end, and a close returns the row to rest. Skipped
     * below 600px, where the bottom nav owns the panel toggles and the panel
     * is a bottom sheet, and on boot (same sentinel as above).
     */
    let prevPanelKey: string | null | undefined;
    effect(() => {
      const panelKey = this._activePanelKey();
      const isFirstRun = prevPanelKey === undefined;
      const isChanged = panelKey !== prevPanelKey;
      prevPanelKey = panelKey;
      if (isFirstRun || !isChanged) {
        return;
      }
      untracked(() => {
        if (this.hasBottomNav()) {
          return;
        }
        this._reveal(panelKey === null ? 'start' : 'end');
      });
    });

    afterNextRender(() => {
      // Re-check the fade whenever the scroller's own box changes -- the window,
      // the side nav, the right panel.
      //
      // It does NOT catch the row's content growing inside a box that stays put
      // (a plugin registering a button). Observing the children was tried and
      // cannot work: this runs before `isDataLoaded()` flips, so the only child
      // that exists yet is `.primary-action-group`, and four of the later ones
      // (`plugin-header-btns`, `plugin-work-context-header-btns`,
      // `plugin-side-panel-btns`, `desktop-panel-buttons`) are `display:
      // contents`, which have no box for a ResizeObserver to report at all.
      // Left uncovered rather than papered over: the row still scrolls, and the
      // fade corrects itself on the first scroll or resize after the change.
      this._isViewReady = true;
      if (typeof ResizeObserver === 'undefined') {
        return;
      }
      const el = this._actionScroll().nativeElement;
      const ro = new ResizeObserver(() => {
        this.onActionScroll();
        // Instant, not smooth: during a panel's width animation this runs per
        // frame, and restarting a smooth scroll each frame would lag the box
        // it is chasing. Re-pinning instantly reads as the row riding along.
        this._applyPendingReveal('auto');
      });
      ro.observe(el);
      this._destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  private _syncTeleport(enabled: boolean): void {
    if (enabled) {
      if (this._teleportedNav?.isConnected) return;
      if (!this._teleportNav()) {
        this._teleportObserver?.disconnect();
        this._teleportObserver = new MutationObserver(() => {
          if (this._teleportNav()) this._teleportObserver?.disconnect();
        });
        this._teleportObserver.observe(this._elRef.nativeElement, {
          childList: true,
          subtree: true,
        });
      }
    } else {
      this._teleportObserver?.disconnect();
      this._teleportObserver = null;
      this._restoreNav();
    }
  }

  private _teleportNav(): boolean {
    if (this._teleportedNav?.isConnected) return true;
    this._teleportedNav = null;
    const nav = (this._elRef.nativeElement as HTMLElement).querySelector(
      'nav.action-nav-right',
    ) as HTMLElement | null;
    if (!nav) return false;
    nav.classList.add('action-nav-right--teleported');
    document.body.appendChild(nav);
    this._teleportedNav = nav;
    return true;
  }

  private _restoreNav(): void {
    const nav = this._teleportedNav;
    if (!nav) return;
    this._teleportedNav = null;
    nav.classList.remove('action-nav-right--teleported');
    const wrapper = (this._elRef.nativeElement as HTMLElement).querySelector('.wrapper');
    if (wrapper) {
      wrapper.appendChild(nav);
    } else {
      nav.remove();
    }
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
    this._teleportObserver?.disconnect();
    this._teleportedNav?.remove();
    this._teleportedNav = null;
  }

  trackById(i: number, item: SimpleCounter): string {
    return item.id;
  }

  sync(): void {
    this.syncWrapperService.sync(true).then((r) => {
      // Keep persistent recovery actions (for example USE_REMOTE Undo) visible;
      // routine sync-success feedback must not replace them.
      if (this._snackService.hasPendingPersistentAction()) {
        return;
      }
      if (
        r === SyncStatus.UpdateLocal ||
        r === SyncStatus.UpdateRemoteAll ||
        r === SyncStatus.UpdateRemote
      ) {
        this._snackService.open({ type: 'SUCCESS', msg: T.F.SYNC.S.SUCCESS_VIA_BUTTON });
      } else if (r === SyncStatus.InSync) {
        this._snackService.open({
          type: 'SUCCESS',
          msg: T.F.SYNC.S.ALREADY_IN_SYNC,
        });
      }
    });
  }

  onSyncButtonClick(): void {
    const ready = !!this.syncIsEnabledAndReady();
    if (ready) {
      this.sync();
    } else {
      this.setupSync();
    }
  }

  private dialogSyncCfgRef: MatDialogRef<unknown> | null = null;

  async setupSync(): Promise<void> {
    // to prevent multiple dialogs on longpress from android
    if (this.dialogSyncCfgRef) {
      return;
    }
    const { DialogSyncCfgComponent } =
      await import('../../imex/sync/dialog-sync-cfg/dialog-sync-cfg.component');
    this.dialogSyncCfgRef = this.matDialog.open(DialogSyncCfgComponent);
    this._subs.add(
      this.dialogSyncCfgRef.afterClosed().subscribe(() => {
        this.dialogSyncCfgRef = null;
      }),
    );
  }

  get kb(): KeyboardConfig {
    return keyboardConfigOrEmpty(this._configService.cfg()?.keyboard as KeyboardConfig);
  }
}
