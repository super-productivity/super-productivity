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
import { toSignal } from '@angular/core/rxjs-interop';
import { ShortcutService } from './core-ui/shortcut/shortcut.service';
import { GlobalConfigService } from './features/config/global-config.service';
import { LayoutService } from './core-ui/layout/layout.service';
import { SnackService } from './core/snack/snack.service';
import { IS_ELECTRON } from './app.constants';
import { expandAnimation } from './ui/animations/expand.ani';
import { warpRouteAnimation } from './ui/animations/warp-route';
import { firstValueFrom, Subscription } from 'rxjs';
import { fadeAnimation } from './ui/animations/fade.ani';
import { BannerService } from './core/banner/banner.service';
import { LS } from './core/persistence/storage-keys.const';
import { BannerId } from './core/banner/banner.model';
import { T } from './t.const';
import { GlobalThemeService } from './core/theme/global-theme.service';
import { LanguageService } from './core/language/language.service';
import { WorkContextService } from './features/work-context/work-context.service';
import { SyncTriggerService } from './imex/sync/sync-trigger.service';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { concatMap, first, take } from 'rxjs/operators';

import { IS_MOBILE } from './util/is-mobile';
import { warpAnimation, warpInAnimation } from './ui/animations/warp.ani';
import { AddTaskBarComponent } from './features/tasks/add-task-bar/add-task-bar.component';
import { Dir } from '@angular/cdk/bidi';
import { MagicSideNavComponent } from './core-ui/magic-side-nav/magic-side-nav.component';
import { MainHeaderComponent } from './core-ui/main-header/main-header.component';
import { BannerComponent } from './core/banner/banner/banner.component';
import { GlobalProgressBarComponent } from './core-ui/global-progress-bar/global-progress-bar.component';
import { FocusModeOverlayComponent } from './features/focus-mode/focus-mode-overlay/focus-mode-overlay.component';
import { DOCUMENT } from '@angular/common';
import { RightPanelComponent } from './features/right-panel/right-panel.component';
import { selectIsOverlayShown } from './features/focus-mode/store/focus-mode.selectors';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { MarkdownPasteService } from './features/tasks/markdown-paste.service';
import { TaskService } from './features/tasks/task.service';
import { MatMenuItem } from '@angular/material/menu';
import { MatIcon } from '@angular/material/icon';
import { NoteStartupBannerService } from './features/note/note-startup-banner.service';
import { ProjectService } from './features/project/project.service';
import { TagService } from './features/tag/tag.service';
import { ContextMenuComponent } from './ui/context-menu/context-menu.component';
import { WorkContextType } from './features/work-context/work-context.model';
import type { WorkContextSettingsDialogData } from './features/work-context/dialog-work-context-settings/dialog-work-context-settings.component';
import { isInputElement } from './util/dom-element';
import { MobileBottomNavComponent } from './core-ui/mobile-bottom-nav/mobile-bottom-nav.component';
import { StartupService } from './core/startup/startup.service';
import { DataInitStateService } from './core/data-init/data-init-state.service';
import { ExampleTasksService } from './core/example-tasks/example-tasks.service';
import { KeyboardLayoutService } from './core/keyboard-layout/keyboard-layout.service';
import { setKeyboardLayoutService } from './util/check-key-combo';
import { OnboardingPresetSelectionComponent } from './features/onboarding/onboarding-preset-selection.component';
import { OnboardingHintComponent } from './features/onboarding/onboarding-hint.component';
import { OnboardingHintService } from './features/onboarding/onboarding-hint.service';
import { MaterialIconsLoaderService } from './ui/material-icons-loader.service';

const ONBOARDING_PRESET_EXIT_DELAY = 1000;
const ONBOARDING_ENTRANCE_COMPLETE_DELAY = 2000;
const ENTRANCE_ANIMATION_DURATION = 1500;

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
    MatMenuItem,
    MatIcon,
    TranslatePipe,
    ContextMenuComponent,
    MobileBottomNavComponent,
    OnboardingPresetSelectionComponent,
    OnboardingHintComponent,
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
  // Injected for side-effect: creates example tasks on first run
  private _exampleTasksService = inject(ExampleTasksService);
  private _keyboardLayoutService = inject(KeyboardLayoutService);
  private _dataInitStateService = inject(DataInitStateService);
  private _materialIconsLoaderService = inject(MaterialIconsLoaderService);
  readonly onboardingHintService = inject(OnboardingHintService);

  private _syncTriggerService = inject(SyncTriggerService);
  readonly workContextService = inject(WorkContextService);
  readonly layoutService = inject(LayoutService);
  readonly globalThemeService = inject(GlobalThemeService);
  readonly _store = inject(Store);
  readonly T = T;
  readonly isShowMobileButtonNav = this.layoutService.isShowMobileBottomNav;

  @ViewChild('routeWrapper', { read: ElementRef }) routeWrapper?: ElementRef<HTMLElement>;

  @HostBinding('class.isWorkViewScrolled') get isWorkViewScrolledClass(): boolean {
    return this.layoutService.isWorkViewScrolled();
  }

  @HostBinding('@.disabled') get isDisableAnimations(): boolean {
    return this._isDisableAnimations();
  }

  private _isDisableAnimations = computed(() => {
    const misc = this._globalConfigService.misc();
    return misc?.isDisableAnimations ?? false;
  });

  isRTL: boolean = false;

  private _isOverlayShownFromStore = toSignal(this._store.select(selectIsOverlayShown), {
    initialValue: false,
  });

  // Only show focus overlay if both the store says to show it AND the feature is enabled
  isShowFocusOverlay = computed(
    () =>
      this._isOverlayShownFromStore() &&
      this._globalConfigService.appFeatures().isFocusModeEnabled,
  );

  private readonly _activeWorkContextId = toSignal(
    this.workContextService.activeWorkContextId$,
    { initialValue: null },
  );

  private readonly _activeWorkContext = toSignal(
    this.workContextService.activeWorkContext$,
    { initialValue: null },
  );

  isShowOnboardingPresets = signal(
    !localStorage.getItem(LS.ONBOARDING_PRESET_DONE) &&
      !localStorage.getItem(LS.IS_SKIP_TOUR),
  );

  private _subs: Subscription = new Subscription();

  constructor() {
    this._startupService.init();
    void this._materialIconsLoaderService.ensureFontReady();

    // Skip onboarding for existing users with data
    if (this.isShowOnboardingPresets()) {
      this._dataInitStateService.isAllDataLoadedInitially$
        .pipe(
          concatMap(() => this._projectService.list$),
          first(),
        )
        .subscribe((projectList) => {
          if (projectList.length > 2) {
            localStorage.setItem(LS.ONBOARDING_PRESET_DONE, 'true');
            this.isShowOnboardingPresets.set(false);
          }
        });
    }

    // Clear app entrance animation after it completes
    if (this.isAppEntrance()) {
      setTimeout(() => {
        this.isAppEntrance.set(false);
      }, ENTRANCE_ANIMATION_DURATION);
    }

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

    this._syncTriggerService.afterInitialSyncDoneAndDataLoadedInitially$
      .pipe(take(1))
      .subscribe(() => {
        void this._noteStartupBannerService.showLastNoteIfNeeded();
      });

    // ! For keyboard shortcuts to work correctly with any layouts (QWERTZ/AZERTY/etc) - user's keyboard layout must be presaved
    // Connect the service to the utility functions
    setKeyboardLayoutService(this._keyboardLayoutService);
    // Defer keyboard layout detection to idle time for better initial load performance
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => this._keyboardLayoutService.saveUserLayout());
    } else {
      setTimeout(() => this._keyboardLayoutService.saveUserLayout(), 0);
    }
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
    if (
      IS_ELECTRON ||
      localStorage.getItem(LS.WEB_APP_INSTALL) ||
      OnboardingHintService.isOnboardingInProgress()
    ) {
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
    this.layoutService.scrollToNewTask(taskId);
  }

  readonly bgOverlayOpacity = computed((): number => {
    const context = this._activeWorkContext();
    const baseOpacity = context?.theme?.backgroundOverlayOpacity ?? 20;

    return baseOpacity * 0.01;
  });

  async openSettings(): Promise<void> {
    const isForProject =
      this.workContextService.activeWorkContextType === WorkContextType.PROJECT;
    const contextId = this.workContextService.activeWorkContextId;
    if (!contextId) {
      return;
    }
    const entity = isForProject
      ? await firstValueFrom(this._projectService.getByIdOnce$(contextId))
      : await firstValueFrom(this._tagService.getTagById$(contextId).pipe(first()));

    const { DialogWorkContextSettingsComponent } =
      await import('./features/work-context/dialog-work-context-settings/dialog-work-context-settings.component');
    this._matDialog.open(DialogWorkContextSettingsComponent, {
      restoreFocus: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      data: {
        isProject: isForProject,
        entity,
      } as WorkContextSettingsDialogData,
    });
  }

  isAppEntrance = signal(!this.isShowOnboardingPresets());

  onPresetSelected(): void {
    this.isAppEntrance.set(true);
    setTimeout(() => {
      this.isShowOnboardingPresets.set(false);
    }, ONBOARDING_PRESET_EXIT_DELAY);
    setTimeout(() => {
      this.isAppEntrance.set(false);
      this.onboardingHintService.startAfterPresetSelection();
    }, ONBOARDING_ENTRANCE_COMPLETE_DELAY);
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
  }

  /**
   * since page load and animation time are not always equal
   * retrying until the rendered task row is available avoids missing focus targets
   */
  private _focusElement(id: string): void {
    this.layoutService.focusTaskInViewWhenReady(id, (el) => {
      if (el && IS_MOBILE) {
        el.classList.add('mobile-highlight-searched-item');
        el.addEventListener('blur', () =>
          el.classList.remove('mobile-highlight-searched-item'),
        );
      }
    });
  }
}
