import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostBinding,
  HostListener,
  inject,
  NgZone,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ShortcutService } from './core-ui/shortcut/shortcut.service';
import { GlobalConfigService } from './features/config/global-config.service';
import { LayoutService } from './core-ui/layout/layout.service';
import { SnackService } from './core/snack/snack.service';
import { IS_ELECTRON } from './app.constants';
import { expandAnimation } from './ui/animations/expand.ani';
import { warpRouteAnimation } from './ui/animations/warp-route';
import { combineLatest, merge, Observable, Subscription, timer } from 'rxjs';
import { fadeAnimation } from './ui/animations/fade.ani';
import { BannerService } from './core/banner/banner.service';
import { LS } from './core/persistence/storage-keys.const';
import { BannerId } from './core/banner/banner.model';
import { T } from './t.const';
import { GlobalThemeService } from './core/theme/global-theme.service';
import { LanguageService } from './core/language/language.service';
import { WorkContextService } from './features/work-context/work-context.service';
import { ImexViewService } from './imex/imex-meta/imex-view.service';
import { SyncTriggerService } from './imex/sync/sync-trigger.service';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { filter, map, take } from 'rxjs/operators';
import { isOnline$ } from './util/is-online';
import { IS_MOBILE } from './util/is-mobile';
import { warpAnimation, warpInAnimation } from './ui/animations/warp.ani';
import { AddTaskBarComponent } from './features/tasks/add-task-bar/add-task-bar.component';
import { Dir } from '@angular/cdk/bidi';
import { MagicSideNavComponent } from './core-ui/magic-side-nav/magic-side-nav.component';
import { MainHeaderComponent } from './core-ui/main-header/main-header.component';
import { BannerComponent } from './core/banner/banner/banner.component';
import { GlobalProgressBarComponent } from './core-ui/global-progress-bar/global-progress-bar.component';
import { FocusModeOverlayComponent } from './features/focus-mode/focus-mode-overlay/focus-mode-overlay.component';
import { ShepherdComponent } from './features/shepherd/shepherd.component';
import { AsyncPipe, DOCUMENT } from '@angular/common';
import { RightPanelComponent } from './features/right-panel/right-panel.component';
import { selectIsOverlayShown } from './features/focus-mode/store/focus-mode.selectors';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { MarkdownPasteService } from './features/tasks/markdown-paste.service';
import { TaskService } from './features/tasks/task.service';
import { MatButton } from '@angular/material/button';
import { MatMenuItem } from '@angular/material/menu';
import { MatIcon } from '@angular/material/icon';
import { DialogUnsplashPickerComponent } from './ui/dialog-unsplash-picker/dialog-unsplash-picker.component';
import { NoteStartupBannerService } from './features/note/note-startup-banner.service';
import { ProjectService } from './features/project/project.service';
import { TagService } from './features/tag/tag.service';
import { ContextMenuComponent } from './ui/context-menu/context-menu.component';
import { WorkContextThemeCfg } from './features/work-context/work-context.model';
import { isInputElement } from './util/dom-element';
import { MobileBottomNavComponent } from './core-ui/mobile-bottom-nav/mobile-bottom-nav.component';
import { StartupService } from './core/startup/startup.service';

const w = window as Window & { productivityTips?: string[][]; randomIndex?: number };
const productivityTip: string[] | undefined =
  w.productivityTips && w.randomIndex !== undefined
    ? w.productivityTips[w.randomIndex]
    : undefined;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  animations: [
    expandAnimation,
    warpRouteAnimation,
    fadeAnimation,
    warpAnimation,
    warpInAnimation,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AddTaskBarComponent,
    Dir,
    MagicSideNavComponent,
    MainHeaderComponent,
    BannerComponent,
    RightPanelComponent,
    RouterOutlet,
    GlobalProgressBarComponent,
    FocusModeOverlayComponent,
    ShepherdComponent,
    AsyncPipe,
    MatButton,
    MatMenuItem,
    MatIcon,
    TranslatePipe,
    ContextMenuComponent,
    MobileBottomNavComponent,
  ],
})
export class AppComponent implements OnDestroy, AfterViewInit {
  private _globalConfigService = inject(GlobalConfigService);
  private _shortcutService = inject(ShortcutService);
  private _bannerService = inject(BannerService);
  private _snackService = inject(SnackService);
  private _globalThemeService = inject(GlobalThemeService);
  private _languageService = inject(LanguageService);
  private _activatedRoute = inject(ActivatedRoute);
  private _matDialog = inject(MatDialog);
  private _markdownPasteService = inject(MarkdownPasteService);
  private _taskService = inject(TaskService);
  private _projectService = inject(ProjectService);
  private _tagService = inject(TagService);
  private _destroyRef = inject(DestroyRef);
  private _noteStartupBannerService = inject(NoteStartupBannerService);
  private _ngZone = inject(NgZone);
  private _document = inject(DOCUMENT, { optional: true });
  private _startupService = inject(StartupService);

  readonly syncTriggerService = inject(SyncTriggerService);
  readonly imexMetaService = inject(ImexViewService);
  readonly workContextService = inject(WorkContextService);
  readonly layoutService = inject(LayoutService);
  readonly globalThemeService = inject(GlobalThemeService);
  readonly _store = inject(Store);
  readonly T = T;
  readonly isShowMobileButtonNav = this.layoutService.isShowMobileBottomNav;

  productivityTipTitle: string = productivityTip?.[0] || '';
  productivityTipText: string = productivityTip?.[1] || '';
  showSkipSyncButton = signal(false);

  @ViewChild('routeWrapper', { read: ElementRef }) routeWrapper?: ElementRef<HTMLElement>;

  @HostBinding('@.disabled') get isDisableAnimations(): boolean {
    return this._isDisableAnimations();
  }

  private _isDisableAnimations = computed(() => {
    const misc = this._globalConfigService.misc();
    return misc?.isDisableAnimations ?? false;
  });

  isRTL: boolean = false;

  isShowUi$: Observable<boolean> = combineLatest([
    this.syncTriggerService.afterInitialSyncDoneAndDataLoadedInitially$,
    this.imexMetaService.isDataImportInProgress$,
  ]).pipe(
    map(
      ([afterInitialIsReady, isDataImportInProgress]) =>
        afterInitialIsReady && !isDataImportInProgress,
    ),
  );

  private _isOverlayShownFromStore = toSignal(this._store.select(selectIsOverlayShown), {
    initialValue: false,
  });

  // Only show focus overlay if both the store says to show it AND the feature is enabled
  isShowFocusOverlay = computed(
    () =>
      this._isOverlayShownFromStore() &&
      this._globalConfigService.cfg()?.appFeatures.isFocusModeEnabled,
  );

  private readonly _activeWorkContextId = toSignal(
    this.workContextService.activeWorkContextId$,
    { initialValue: null },
  );

  private _subs: Subscription = new Subscription();
  private _intervalTimer?: NodeJS.Timeout;

  constructor() {
    this._startupService.init();

    // Use effect to react to language RTL changes
    effect(() => {
      const val = this._languageService.isLangRTL();
      this.isRTL = val;
      document.dir = this.isRTL ? 'rtl' : 'ltr';
    });

    this._subs.add(
      this._activatedRoute.queryParams.subscribe((params) => {
        if (!!params.focusItem) {
          this._focusElement(params.focusItem);
        }
      }),
    );

    // init theme and body class handlers
    this._globalThemeService.init();

    this.syncTriggerService.afterInitialSyncDoneAndDataLoadedInitially$
      .pipe(take(1))
      .subscribe(() => {
        void this._noteStartupBannerService.showLastNoteIfNeeded();
      });

    // Show skip sync button immediately if offline, otherwise after 3 seconds
    merge(
      // Immediate trigger if offline
      isOnline$.pipe(
        filter((isOnline) => !isOnline),
        take(1),
      ),
      // Fallback after 3 seconds regardless
      timer(3000),
    )
      .pipe(take(1), takeUntilDestroyed())
      .subscribe(() => {
        this.showSkipSyncButton.set(true);
      });
  }

  skipInitialSync(): void {
    this.syncTriggerService.setInitialSyncDone(true);
  }

  @HostListener('document:paste', ['$event']) onPaste(ev: ClipboardEvent): void {
    // Skip handling inside input elements
    const target = ev.target as HTMLElement;
    if (isInputElement(target)) return;

    const clipboardData = ev.clipboardData;
    if (!clipboardData) return;

    const pastedText = clipboardData.getData('text/plain');
    if (!pastedText) return;

    if (!this._markdownPasteService.isMarkdownTaskList(pastedText)) return;

    // Prevent default paste behavior
    ev.preventDefault();

    // Check if paste is happening on a task element
    let taskId: string | null = null;
    let taskTitle: string | null = null;
    let isSubTask = false;

    // Find task element by traversing up the DOM tree
    let element: HTMLElement | null = target;
    while (element && !element.id.startsWith('t-')) {
      element = element.parentElement;
    }

    if (element && element.id.startsWith('t-')) {
      // Extract task ID from DOM id (format: "t-{taskId}")
      taskId = element.id.substring(2);

      // Get task data to determine if it's a sub-task
      this._taskService.getByIdOnce$(taskId).subscribe((task) => {
        if (task) {
          taskTitle = task.title;
          isSubTask = !!task.parentId;
          this._markdownPasteService.handleMarkdownPaste(
            pastedText,
            taskId,
            taskTitle,
            isSubTask,
          );
        } else {
          // Fallback: handle as parent tasks if task not found
          this._markdownPasteService.handleMarkdownPaste(pastedText, null);
        }
      });
    } else {
      // Handle as parent tasks since no specific task context
      this._markdownPasteService.handleMarkdownPaste(pastedText, null);
    }
  }

  @HostListener('window:beforeinstallprompt', ['$event']) onBeforeInstallPrompt(
    e: BeforeInstallPromptEvent,
  ): void {
    if (IS_ELECTRON || localStorage.getItem(LS.WEB_APP_INSTALL)) {
      return;
    }

    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();

    window.setTimeout(
      () => {
        this._bannerService.open({
          id: BannerId.InstallWebApp,
          msg: T.APP.B_INSTALL.MSG,
          action: {
            label: T.APP.B_INSTALL.INSTALL,
            fn: () => {
              e.prompt();
            },
          },
          action2: {
            label: T.APP.B_INSTALL.IGNORE,
            fn: () => {
              localStorage.setItem(LS.WEB_APP_INSTALL, 'true');
            },
          },
        });
      },
      2 * 60 * 1000,
    );
  }

  getPage(outlet: RouterOutlet): string {
    return outlet.activatedRouteData.page || 'one';
  }

  getActiveWorkContextId(): string | null {
    return this._activeWorkContextId();
  }

  onTaskAdded({ taskId }: { taskId: string; isAddToBottom: boolean }): void {
    this.layoutService.setPendingFocusTaskId(taskId);
  }

  changeBackgroundFromUnsplash(): void {
    const dialogRef = this._matDialog.open(DialogUnsplashPickerComponent, {
      width: '900px',
      maxWidth: '95vw',
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        // Get current work context
        this.workContextService.activeWorkContext$
          .pipe(take(1))
          .subscribe((activeContext) => {
            if (!activeContext) {
              this._snackService.open({
                type: 'ERROR',
                msg: 'No active work context',
              });
              return;
            }

            // Extract the URL from the result object
            const backgroundUrl = result.url || result;
            const isDarkMode = this._globalThemeService.isDarkTheme();
            const contextKey: keyof WorkContextThemeCfg = isDarkMode
              ? 'backgroundImageDark'
              : 'backgroundImageLight';

            // Update the theme based on context type
            if (activeContext.type === 'PROJECT') {
              this._projectService.update(activeContext.id, {
                theme: {
                  ...(activeContext.theme || {}),
                  [contextKey]: backgroundUrl,
                },
              });
            } else if (activeContext.type === 'TAG') {
              this._tagService.updateTag(activeContext.id, {
                theme: {
                  ...(activeContext.theme || {}),
                  [contextKey]: backgroundUrl,
                },
              });
            }
          });
      }
    });
  }

  ngAfterViewInit(): void {
    this._ngZone.runOutsideAngular(() => {
      const doc = this._document!;
      // Handle global document events outside Angular to avoid change detection churn.
      // - dragover/drop: block the browser's default file-drop navigation.
      // - keydown: route shortcuts and only re-enter Angular when they matter.
      // Prevent the browser from treating file drops as navigation events
      const onDragOver = (ev: DragEvent): void => {
        ev.preventDefault();
      };

      // Ensure accidental file drops don’t replace the SPA with the dropped file
      const onDrop = (ev: DragEvent): void => {
        ev.preventDefault();
      };

      const onKeyDown = (ev: KeyboardEvent): void => {
        this._ngZone.run(() => {
          void this._shortcutService.handleKeyDown(ev);
        });
      };

      doc.addEventListener('dragover', onDragOver, { passive: false });
      doc.addEventListener('drop', onDrop, { passive: false });
      doc.addEventListener('keydown', onKeyDown);

      this._destroyRef.onDestroy(() => {
        doc.removeEventListener('dragover', onDragOver);
        doc.removeEventListener('drop', onDrop);
        doc.removeEventListener('keydown', onKeyDown);
      });
    });
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
    if (this._intervalTimer) clearInterval(this._intervalTimer);
  }

  /**
   * since page load and animation time are not always equal
   * an interval seemed to feel the most responsive
   */
  private _focusElement(id: string): void {
    let counter = 0;
    this._intervalTimer = setInterval(() => {
      counter += 1;

      const el = document.getElementById(`t-${id}`);
      el?.focus();

      if (el && IS_MOBILE) {
        el.classList.add('mobile-highlight-searched-item');
        el.addEventListener('blur', () =>
          el.classList.remove('mobile-highlight-searched-item'),
        );
      }

      if ((el || counter === 4) && this._intervalTimer) {
        clearInterval(this._intervalTimer);
      }
    }, 400);
  }
}
