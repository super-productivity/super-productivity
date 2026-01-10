import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
import { ProjectService } from '../../features/project/project.service';
import { LayoutService } from '../layout/layout.service';
import { TaskService } from '../../features/tasks/task.service';
import { T } from '../../t.const';
import { fadeAnimation } from '../../ui/animations/fade.ani';
import { filter, map, startWith, switchMap } from 'rxjs/operators';
import { of, Subscription } from 'rxjs';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { expandFadeHorizontalAnimation } from '../../ui/animations/expand.ani';
import { SimpleCounterService } from '../../features/simple-counter/simple-counter.service';
import { SimpleCounter } from '../../features/simple-counter/simple-counter.model';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { SnackService } from '../../core/snack/snack.service';
import { NavigationEnd, Router } from '@angular/router';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { KeyboardConfig } from 'src/app/features/config/keyboard-config.model';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { SimpleCounterButtonComponent } from '../../features/simple-counter/simple-counter-button/simple-counter-button.component';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { DialogSyncInitialCfgComponent } from '../../imex/sync/dialog-sync-initial-cfg/dialog-sync-initial-cfg.component';
import { LongPressDirective } from '../../ui/longpress/longpress.directive';
import { isOnline$ } from '../../util/is-online';
import { Store } from '@ngrx/store';
import { showFocusOverlay } from '../../features/focus-mode/store/focus-mode.actions';
import { SyncStatus } from '../../pfapi/api';
import { PluginHeaderBtnsComponent } from '../../plugins/ui/plugin-header-btns.component';
import { PluginSidePanelBtnsComponent } from '../../plugins/ui/plugin-side-panel-btns.component';
import { PageTitleComponent } from './page-title/page-title.component';
import { PlayButtonComponent } from './play-button/play-button.component';
import { DesktopPanelButtonsComponent } from './desktop-panel-buttons/desktop-panel-buttons.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { MetricService } from '../../features/metric/metric.service';
import { DateService } from '../../core/date/date.service';
import { UserProfileButtonComponent } from '../../features/user-profile/user-profile-button/user-profile-button.component';
import { FocusButtonComponent } from './focus-button/focus-button.component';
import { UserProfileService } from '../../features/user-profile/user-profile.service';

@Component({
  selector: 'main-header',
  templateUrl: './main-header.component.html',
  styleUrls: ['./main-header.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [fadeAnimation, expandFadeHorizontalAnimation],
  imports: [
    MatIconButton,
    MatIcon,
    MatTooltip,
    TranslatePipe,
    SimpleCounterButtonComponent,
    LongPressDirective,
    PluginHeaderBtnsComponent,
    PluginSidePanelBtnsComponent,
    PageTitleComponent,
    PlayButtonComponent,
    DesktopPanelButtonsComponent,
    UserProfileButtonComponent,
    FocusButtonComponent,
  ],
})
export class MainHeaderComponent implements OnDestroy {
  readonly projectService = inject(ProjectService);
  readonly matDialog = inject(MatDialog);
  readonly workContextService = inject(WorkContextService);
  readonly taskService = inject(TaskService);
  readonly layoutService = inject(LayoutService);
  readonly simpleCounterService = inject(SimpleCounterService);
  readonly syncWrapperService = inject(SyncWrapperService);
  readonly globalConfigService = inject(GlobalConfigService);
  private readonly _snackService = inject(SnackService);
  private readonly _router = inject(Router);
  private readonly _store = inject(Store);
  private readonly _configService = inject(GlobalConfigService);
  private readonly _metricService = inject(MetricService);
  private readonly _dateService = inject(DateService);

  T: typeof T = T;
  isShowSimpleCounterBtnsMobile = signal(false);

  isXs = this.layoutService.isXs;
  isXxxs = this.layoutService.isXxxs;

  showDesktopButtons = computed(() => !this.isXs());

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

  private _isRouteWithSidePanel$ = this._router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map((event) => true), // Always true since right-panel is now global
    startWith(true), // Always true since right-panel is now global
  );
  isRouteWithSidePanel = toSignal(this._isRouteWithSidePanel$, { initialValue: true });

  private _isScheduleSection$ = this._router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map((event) => !!event.urlAfterRedirects.match(/(schedule)$/)),
    startWith(!!this._router.url.match(/(schedule)$/)),
  );
  isScheduleSection = toSignal(this._isScheduleSection$, { initialValue: false });

  // Convert more observables to signals

  currentTask = toSignal(this.taskService.currentTask$);
  currentTaskId = this.taskService.currentTaskId;
  enabledSimpleCounters = toSignal(this.simpleCounterService.enabledSimpleCounters$, {
    initialValue: [],
  });
  isShowIssuePanel = computed(() => this.layoutService.isShowIssuePanel());
  isShowNotes = computed(() => this.layoutService.isShowNotes());
  isShowScheduleDayPanel = computed(() => this.layoutService.isShowScheduleDayPanel());
  syncIsEnabledAndReady = toSignal(this.syncWrapperService.isEnabledAndReady$);
  syncState = toSignal(this.syncWrapperService.syncState$);
  isSyncInProgress = toSignal(this.syncWrapperService.isSyncInProgress$);
  focusModeConfig = toSignal(
    this.globalConfigService.cfg$.pipe(map((cfg) => cfg?.focusMode)),
  );
  isOnline = toSignal(isOnline$);
  focusSummaryToday = computed(() =>
    this._metricService.getFocusSummaryForDay(this._dateService.todayStr()),
  );
  readonly isTimeTrackingEnabled = computed(() => {
    return this.globalConfigService.cfg()?.appFeatures.isTimeTrackingEnabled;
  });
  readonly isFocusModeEnabled = computed(() => {
    return this.globalConfigService.cfg()?.appFeatures.isFocusModeEnabled;
  });
  readonly isSyncIconEnabled = computed(() => {
    return this.globalConfigService.cfg()?.appFeatures.isSyncIconEnabled;
  });

  // Check if there are any undone tasks that can be tracked
  private readonly _hasTrackableTasks$ = this.workContextService.undoneTasks$.pipe(
    map((tasks) => tasks.length > 0),
  );
  hasTrackableTasks = toSignal(this._hasTrackableTasks$, { initialValue: true });

  private readonly _userProfileService = inject(UserProfileService);
  isUserProfilesEnabled = computed(() => {
    return (
      this.globalConfigService.cfg()?.appFeatures.isEnableUserProfiles &&
      this._userProfileService.isInitialized()
    );
  });

  private _subs: Subscription = new Subscription();

  selectedTimeView = computed(() => this.layoutService.selectedTimeView());

  selectTimeView(view: 'week' | 'month'): void {
    this.layoutService.selectedTimeView.set(view);
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  trackById(i: number, item: SimpleCounter): string {
    return item.id;
  }

  sync(): void {
    this.syncWrapperService.sync().then((r) => {
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

  private dialogSyncCfgRef: MatDialogRef<DialogSyncInitialCfgComponent> | null = null;

  setupSync(): void {
    // to prevent multiple dialogs on longpress from android
    if (this.dialogSyncCfgRef) {
      return;
    }
    this.dialogSyncCfgRef = this.matDialog.open(DialogSyncInitialCfgComponent);
    this._subs.add(
      this.dialogSyncCfgRef.afterClosed().subscribe(() => {
        this.dialogSyncCfgRef = null;
      }),
    );
  }

  isCounterRunning(counters: SimpleCounter[]): boolean {
    return !!(counters && counters.find((counter) => counter.isOn));
  }

  enableFocusMode(): void {
    this._store.dispatch(showFocusOverlay());
  }

  get kb(): KeyboardConfig {
    return (this._configService.cfg()?.keyboard as KeyboardConfig) || {};
  }
}
