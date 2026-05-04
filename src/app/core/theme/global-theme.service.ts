import {
  DestroyRef,
  effect,
  EnvironmentInjector,
  inject,
  Injectable,
  runInInjectionContext,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { BodyClass, IS_ELECTRON, IS_GNOME_DESKTOP } from '../../app.constants';
import { IS_MAC } from '../../util/is-mac';
import { distinctUntilChanged, map, startWith, switchMap, take } from 'rxjs/operators';
import { IS_TOUCH_ONLY } from '../../util/is-touch-only';
import { MaterialCssVarsService } from 'angular-material-css-vars';
import { DOCUMENT } from '@angular/common';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { ChromeExtensionInterfaceService } from '../chrome-extension-interface/chrome-extension-interface.service';

import { GlobalConfigService } from '../../features/config/global-config.service';
import { WorkContextThemeCfg } from '../../features/work-context/work-context.model';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { combineLatest, fromEvent, Observable, of } from 'rxjs';
import { IS_FIREFOX } from '../../util/is-firefox';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import {
  IS_HYBRID_DEVICE,
  IS_MOUSE_PRIMARY,
  IS_TOUCH_PRIMARY,
} from '../../util/is-mouse-primary';
// Injected to ensure constructor runs and registers global pointer event listeners
import { InputIntentService } from '../input-intent/input-intent.service';
import { ipcEnterFullScreen$, ipcLeaveFullScreen$ } from '../ipc-events';

import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { androidInterface } from '../../features/android/android-interface';
import { HttpClient } from '@angular/common/http';
import { CapacitorPlatformService } from '../platform/capacitor-platform.service';
import { Keyboard, KeyboardInfo } from '@capacitor/keyboard';
import { PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SafeArea } from 'capacitor-plugin-safe-area';
import { FlexibleConnectedPositionStrategy } from '@angular/cdk/overlay';
import { LS } from '../persistence/storage-keys.const';
import { CustomThemeService } from './custom-theme.service';
import { Log } from '../log';
import { LayoutService } from '../../core-ui/layout/layout.service';

interface NavigationBarPlugin {
  setColor(options: { color: string; style: 'LIGHT' | 'DARK' }): Promise<void>;
}

const NavigationBar = registerPlugin<NavigationBarPlugin>('NavigationBar');

export type DarkModeCfg = 'dark' | 'light' | 'system';

const CSS_VAR_KEYBOARD_HEIGHT = '--keyboard-height';
const CSS_VAR_KEYBOARD_OVERLAY_OFFSET = '--keyboard-overlay-offset';
const CSS_VAR_VISUAL_VIEWPORT_HEIGHT = '--visual-viewport-height';
const CSS_VAR_SAFE_AREA_TOP = '--safe-area-inset-top';
const CSS_VAR_SAFE_AREA_BOTTOM = '--safe-area-inset-bottom';
const CSS_VAR_SAFE_AREA_LEFT = '--safe-area-inset-left';
const CSS_VAR_SAFE_AREA_RIGHT = '--safe-area-inset-right';
const VIEWPORT_RESIZE_EPSILON_PX = 1;

@Injectable({ providedIn: 'root' })
export class GlobalThemeService {
  private document = inject<Document>(DOCUMENT);
  private _layoutService = inject(LayoutService);
  private _materialCssVarsService = inject(MaterialCssVarsService);
  private _workContextService = inject(WorkContextService);
  private _globalConfigService = inject(GlobalConfigService);
  private _matIconRegistry = inject(MatIconRegistry);
  private readonly _registeredPluginIcons = new Set<string>();
  private _domSanitizer = inject(DomSanitizer);

  private _chromeExtensionInterfaceService = inject(ChromeExtensionInterfaceService);
  private _imexMetaService = inject(ImexViewService);
  private _http = inject(HttpClient);
  private _customThemeService = inject(CustomThemeService);
  private _platformService = inject(CapacitorPlatformService);
  private _environmentInjector = inject(EnvironmentInjector);
  private _destroyRef = inject(DestroyRef);
  private _inputIntentService = inject(InputIntentService);
  private _hasInitialized = false;
  private _keyboardListenerHandles: PluginListenerHandle[] = [];
  private _focusinListener: ((event: FocusEvent) => void) | null = null;
  private _visualViewportResizeListener: (() => void) | null = null;
  private _iosKeyboardHeight = 0;
  private _iosViewportHeightBeforeKeyboard = 0;
  private _iosViewportChangeRaf: number | null = null;

  private _isCustomWindowTitleBarEnabled(): boolean {
    const misc = this._globalConfigService.misc();
    return misc?.isUseCustomWindowTitleBar ?? !IS_GNOME_DESKTOP;
  }

  darkMode = signal<DarkModeCfg>(
    (localStorage.getItem(LS.DARK_MODE) as DarkModeCfg) || 'system',
  );

  private _isDarkThemeObs$: Observable<boolean> = toObservable(this.darkMode).pipe(
    switchMap((darkMode) => {
      switch (darkMode) {
        case 'dark':
          return of(true);
        case 'light':
          return of(false);
        default:
          const darkModePreference = window.matchMedia('(prefers-color-scheme: dark)');
          return fromEvent(darkModePreference, 'change').pipe(
            map((e: any) => e.matches),
            startWith(darkModePreference.matches),
          );
      }
    }),
    distinctUntilChanged(),
  );

  isDarkTheme = toSignal(this._isDarkThemeObs$, { initialValue: false });

  private _backgroundImgObs$: Observable<string | null | undefined> = combineLatest([
    this._workContextService.currentTheme$,
    this._isDarkThemeObs$,
  ]).pipe(
    map(([theme, isDarkMode]) =>
      isDarkMode ? theme.backgroundImageDark : theme.backgroundImageLight,
    ),
    distinctUntilChanged(),
  );

  backgroundImg = toSignal(this._backgroundImgObs$);

  init(): void {
    if (this._hasInitialized) {
      return;
    }
    this._hasInitialized = true;

    runInInjectionContext(this._environmentInjector, () => {
      // This is here to make web page reloads on non-work-context pages at least usable
      this._setBackgroundTint(true);
      this._initIcons();
      this._initHandlersForInitialBodyClasses();
      this._initThemeWatchers();

      // Set up dark mode persistence effect
      effect(() => {
        const darkMode = this.darkMode();
        localStorage.setItem(LS.DARK_MODE, darkMode);
      });

      // Set up reactive custom theme updates
      this._setupCustomThemeEffect();
    });
  }

  private _setDarkTheme(isDarkTheme: boolean): void {
    this._materialCssVarsService.setDarkTheme(isDarkTheme);
    this._setChartTheme(isDarkTheme).catch((err) => {
      Log.warn('Failed to set chart theme', err);
    });
    // this._materialCssVarsService.setDarkTheme(true);
    // this._materialCssVarsService.setDarkTheme(false);
  }

  private _setColorTheme(theme: WorkContextThemeCfg): void {
    this._materialCssVarsService.setAutoContrastEnabled(!!theme.isAutoContrast);
    this._setBackgroundTint(!!theme.isDisableBackgroundTint);

    // NOTE: setting undefined values does not seem to be a problem so we use !
    if (!theme.isAutoContrast) {
      this._materialCssVarsService.setContrastColorThresholdPrimary(theme.huePrimary!);
      this._materialCssVarsService.setContrastColorThresholdAccent(theme.hueAccent!);
      this._materialCssVarsService.setContrastColorThresholdWarn(theme.hueWarn!);
    }

    this._materialCssVarsService.setPrimaryColor(theme.primary!);
    this._materialCssVarsService.setAccentColor(theme.accent!);
    this._materialCssVarsService.setWarnColor(theme.warn!);
  }

  private _setBackgroundTint(isDisableBackgroundTint: boolean): void {
    // Simplify: toggle only the disable flag; CSS handles the rest
    this.document.body.classList.toggle(
      BodyClass.isDisableBackgroundTint,
      !!isDisableBackgroundTint,
    );
  }

  private _initIcons(): void {
    const icons: [string, string][] = [
      ['sp', 'assets/icons/sp.svg'],
      ['github', 'assets/icons/github.svg'],
      ['gitlab', 'assets/icons/gitlab.svg'],
      ['jira', 'assets/icons/jira.svg'],
      ['caldav', 'assets/icons/caldav.svg'],
      ['calendar', 'assets/icons/calendar.svg'],
      ['open_project', 'assets/icons/open-project.svg'],
      ['remove_today', 'assets/icons/remove-today-48px.svg'],
      ['working_today', 'assets/icons/working-today.svg'],
      ['repeat', 'assets/icons/repeat.svg'],
      ['gitea', 'assets/icons/gitea.svg'],
      ['redmine', 'assets/icons/redmine.svg'],
      ['linear', 'assets/icons/linear.svg'],
      ['clickup', 'assets/icons/clickup.svg'],
      // trello icon
      ['trello', 'assets/icons/trello.svg'],
      ['tomorrow', 'assets/icons/tomorrow.svg'],
      ['next_week', 'assets/icons/next-week.svg'],
      ['habit', 'assets/icons/habit.svg'],
      ['azure_devops', 'assets/icons/azure_devops.svg'],
      ['nextcloud_deck', 'assets/icons/nextcloud_deck.svg'],
    ];

    // todo test if can be removed with airplane mode and wifi without internet
    icons.forEach(([name, path]) => {
      this._matIconRegistry.addSvgIcon(
        name,
        this._domSanitizer.bypassSecurityTrustResourceUrl(path),
      );
    });

    this.preloadIcons(icons);
  }

  preloadIcons(icons: [string, string][]): Promise<void[]> {
    // Map each icon name to a promise that fetches and registers the icon.
    const iconPromises = icons.map(([iconName, url]) => {
      // Construct the URL for the SVG file.
      // Adjust the path if your SVGs are located elsewhere.
      return this._http
        .get(url, { responseType: 'text' })
        .toPromise()
        .then((svg) => {
          // Register the fetched SVG as an inline icon.
          this._matIconRegistry.addSvgIconLiteral(
            iconName,
            this._domSanitizer.bypassSecurityTrustHtml(svg),
          );
        })
        .catch((error) => {
          Log.err(`Error loading icon: ${iconName} from ${url}`, error);
        });
    });

    // Return a promise that resolves when all icons have been processed.
    return Promise.all(iconPromises);
  }

  registerSvgIcon(iconName: string, url: string): void {
    // Plugin icon is already registered, skip
    if (this._registeredPluginIcons.has(iconName)) return;
    this._matIconRegistry.addSvgIcon(
      iconName,
      this._domSanitizer.bypassSecurityTrustResourceUrl(url),
    );
    this._registeredPluginIcons.add(iconName);
  }

  hasPluginIcon(iconName: string): boolean {
    return this._registeredPluginIcons.has(iconName);
  }

  registerSvgIconFromContent(iconName: string, svgContent: string): void {
    // Plugin icon is already registered, skip
    if (this._registeredPluginIcons.has(iconName)) return;
    this._matIconRegistry.addSvgIconLiteral(
      iconName,
      this._domSanitizer.bypassSecurityTrustHtml(svgContent),
    );
    this._registeredPluginIcons.add(iconName);
  }

  private _initThemeWatchers(): void {
    // init theme watchers
    this._workContextService.currentTheme$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((theme: WorkContextThemeCfg) => this._setColorTheme(theme));
    this._isDarkThemeObs$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((isDarkTheme) => this._setDarkTheme(isDarkTheme));

    // Update Electron title bar overlay when dark mode changes
    if (IS_ELECTRON && !IS_MAC) {
      effect(() => {
        const isDark = this.isDarkTheme();
        // Use untracked to prevent creating additional dependencies in this effect
        const isCustomWindowTitleBarEnabled = untracked(() =>
          this._isCustomWindowTitleBarEnabled(),
        );
        // Only update if custom window title bar is enabled
        if (isCustomWindowTitleBarEnabled) {
          window.ea.updateTitleBarDarkMode(isDark);
        }
      });
    }
  }

  private _initHandlersForInitialBodyClasses(): void {
    this.document.body.classList.add(BodyClass.isNoAdvancedFeatures);

    if (!IS_FIREFOX) {
      this.document.body.classList.add(BodyClass.isNoFirefox);
    }

    if (IS_MAC) {
      this.document.body.classList.add(BodyClass.isMac);
    } else {
      this.document.body.classList.add(BodyClass.isNoMac);
    }

    if (IS_ELECTRON) {
      this.document.body.classList.add(BodyClass.isElectron);
      this.document.body.classList.add(BodyClass.isAdvancedFeatures);
      this.document.body.classList.remove(BodyClass.isNoAdvancedFeatures);
      ipcEnterFullScreen$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe(() => {
        this.document.body.classList.add(BodyClass.isFullScreen);
      });
      ipcLeaveFullScreen$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe(() => {
        this.document.body.classList.remove(BodyClass.isFullScreen);
      });
    } else {
      this.document.body.classList.add(BodyClass.isWeb);
      this._chromeExtensionInterfaceService.onReady$.pipe(take(1)).subscribe(() => {
        this.document.body.classList.add(BodyClass.isExtension);
        this.document.body.classList.add(BodyClass.isAdvancedFeatures);
        this.document.body.classList.remove(BodyClass.isNoAdvancedFeatures);
      });
    }

    // Add native mobile platform classes
    if (this._platformService.isNative) {
      this.document.body.classList.add(BodyClass.isNativeMobile);
      this._initMobileStatusBar();
      this._initSafeAreaInsets();

      if (this._platformService.isIOS()) {
        this.document.body.classList.add(BodyClass.isIOS);
        this._initIOSKeyboardHandling();

        // Add iPad-specific class for tablet optimizations
        if (this._platformService.isIPad()) {
          this.document.body.classList.add(BodyClass.isIPad);
        }
      }
    }

    if (IS_ANDROID_WEB_VIEW) {
      androidInterface.isKeyboardShown$
        .pipe(takeUntilDestroyed(this._destroyRef))
        .subscribe((isShown) => {
          Log.log('isShown', isShown);

          this.document.body.classList.remove(BodyClass.isAndroidKeyboardHidden);
          this.document.body.classList.remove(BodyClass.isAndroidKeyboardShown);
          this.document.body.classList.remove(BodyClass.isKeyboardVisible);
          this.document.body.classList.add(
            isShown
              ? BodyClass.isAndroidKeyboardShown
              : BodyClass.isAndroidKeyboardHidden,
          );
          if (isShown) {
            this.document.body.classList.add(BodyClass.isKeyboardVisible);
          }
        });
    }

    // Use effect to reactively update animation class
    effect(() => {
      const misc = this._globalConfigService.misc();
      if (misc?.isDisableAnimations) {
        this.document.body.classList.add(BodyClass.isDisableAnimations);
      } else {
        this.document.body.classList.remove(BodyClass.isDisableAnimations);
      }
    });

    effect(() => {
      if (this._isCustomWindowTitleBarEnabled()) {
        this.document.body.classList.add(BodyClass.isObsidianStyleHeader);
      } else {
        this.document.body.classList.remove(BodyClass.isObsidianStyleHeader);
      }
    });

    // Add/remove hasBgImage class to body when background image changes
    effect(() => {
      if (this.backgroundImg()) {
        this.document.body.classList.add(BodyClass.hasBgImage);
      } else {
        this.document.body.classList.remove(BodyClass.hasBgImage);
      }
    });

    // Add/remove has-mobile-bottom-nav class to body for snack bar positioning
    effect(() => {
      if (this._layoutService.isShowMobileBottomNav()) {
        this.document.body.classList.add(BodyClass.hasMobileBottomNav);
      } else {
        this.document.body.classList.remove(BodyClass.hasMobileBottomNav);
      }
    });

    this._imexMetaService.isDataImportInProgress$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((isInProgress) => {
        // timer(1000, 5000)
        //   .pipe(map((val) => val % 2 === 0))
        //   .subscribe((isInProgress) => {
        if (isInProgress) {
          this.document.body.classList.add(BodyClass.isDataImportInProgress);
        } else {
          this.document.body.classList.remove(BodyClass.isDataImportInProgress);
        }
      });

    if (IS_TOUCH_ONLY) {
      this.document.body.classList.add(BodyClass.isTouchOnly);
    } else {
      this.document.body.classList.add(BodyClass.isNoTouchOnly);
    }

    // On hybrid devices, InputIntentService dynamically toggles these classes
    if (!IS_HYBRID_DEVICE) {
      if (IS_MOUSE_PRIMARY) {
        this.document.body.classList.add(BodyClass.isMousePrimary);
      } else if (IS_TOUCH_PRIMARY) {
        this.document.body.classList.add(BodyClass.isTouchPrimary);
      }
    }
  }

  private async _setChartTheme(isDarkTheme: boolean): Promise<void> {
    const { ThemeService } = await import('ng2-charts');

    const chartThemeService = this._environmentInjector.get(ThemeService);

    const overrides: import('chart.js').ChartConfiguration['options'] = isDarkTheme
      ? {
          scales: {
            x: {
              ticks: {
                color: 'white',
              },
              grid: {
                color: 'rgba(255,255,255,0.1)',
              },
            },

            y: {
              ticks: {
                color: 'white',
              },
              grid: {
                color: 'rgba(255,255,255,0.1)',
              },
            },
          },
        }
      : {
          scales: {},
        };
    chartThemeService.setColorschemesOptions(overrides);
  }

  private _setupCustomThemeEffect(): void {
    // Track previous theme to avoid unnecessary reloads
    let previousThemeId: string | null = null;

    // Set up effect to reactively update custom theme when config changes
    effect(() => {
      const misc = this._globalConfigService.misc();
      const themeId = misc?.customTheme || 'default';

      // Only load theme if it has changed
      if (themeId !== previousThemeId) {
        this._customThemeService.loadTheme(themeId);
        previousThemeId = themeId;
      }
    });
  }

  /**
   * Initialize iOS keyboard visibility tracking using Capacitor Keyboard plugin.
   * Adds/removes CSS classes when keyboard shows/hides.
   */
  private _initIOSKeyboardHandling(): void {
    // Show the native iOS accessory bar ("Done" button) above the keyboard
    Keyboard.setAccessoryBarVisible({ isVisible: true });
    this._updateIOSKeyboardViewportVars();

    if (window.visualViewport) {
      this._visualViewportResizeListener = (): void => {
        this._updateIOSKeyboardViewportVars();
      };
      window.visualViewport.addEventListener(
        'resize',
        this._visualViewportResizeListener,
        { passive: true },
      );
    }

    Keyboard.addListener('keyboardWillShow', (info: KeyboardInfo) => {
      Log.log('iOS keyboard will show', info);
      if (!this.document.body.classList.contains(BodyClass.isKeyboardVisible)) {
        this._iosViewportHeightBeforeKeyboard = window.innerHeight;
      }
      this._iosKeyboardHeight = info.keyboardHeight;
      this.document.body.classList.add(BodyClass.isKeyboardVisible);
      // Set CSS variable for keyboard height to adjust layout
      this.document.documentElement.style.setProperty(
        CSS_VAR_KEYBOARD_HEIGHT,
        `${info.keyboardHeight}px`,
      );
      this._updateIOSKeyboardViewportVars();
    }).then((handle) => this._keyboardListenerHandles.push(handle));

    // Use keyboardDidShow for scroll (after animation completes)
    Keyboard.addListener('keyboardDidShow', () => {
      this._updateIOSKeyboardViewportVars();
      this._scrollActiveInputIntoView();
    }).then((handle) => this._keyboardListenerHandles.push(handle));

    Keyboard.addListener('keyboardWillHide', () => {
      Log.log('iOS keyboard will hide');
      this._iosKeyboardHeight = 0;
      this._iosViewportHeightBeforeKeyboard = 0;
      this.document.body.classList.remove(BodyClass.isKeyboardVisible);
      this.document.documentElement.style.setProperty(CSS_VAR_KEYBOARD_HEIGHT, '0px');
      this.document.documentElement.style.setProperty(
        CSS_VAR_KEYBOARD_OVERLAY_OFFSET,
        '0px',
      );
      this._updateIOSKeyboardViewportVars();
    }).then((handle) => this._keyboardListenerHandles.push(handle));

    // Also handle focus changes while keyboard is already visible
    this._focusinListener = (event: FocusEvent): void => {
      const target = event.target as HTMLElement;
      if (
        this.document.body.classList.contains(BodyClass.isKeyboardVisible) &&
        this._isInputElement(target)
      ) {
        // Small delay to let CSS padding apply, validate element is still focused
        setTimeout(() => {
          if (this.document.activeElement === target) {
            this._scrollActiveInputIntoView();
          }
        }, 50);
      }
    };
    this.document.addEventListener('focusin', this._focusinListener, { passive: true });

    // Cleanup listeners on destroy
    this._destroyRef.onDestroy(() => {
      this._keyboardListenerHandles.forEach((handle) => handle.remove());
      if (this._visualViewportResizeListener && window.visualViewport) {
        window.visualViewport.removeEventListener(
          'resize',
          this._visualViewportResizeListener,
        );
      }
      if (this._iosViewportChangeRaf !== null) {
        window.cancelAnimationFrame(this._iosViewportChangeRaf);
      }
      if (this._focusinListener) {
        this.document.removeEventListener('focusin', this._focusinListener);
      }
    });
  }

  private _updateIOSKeyboardViewportVars(): void {
    const root = this.document.documentElement;
    const visualViewportHeight = window.visualViewport?.height;
    const baseHeight = this._iosViewportHeightBeforeKeyboard || window.innerHeight;
    const isKeyboardVisible = this._iosKeyboardHeight > 0;
    const isVisualViewportAlreadyResized = this._isVisualViewportResizedForKeyboard(
      isKeyboardVisible,
      baseHeight,
      visualViewportHeight,
    );
    const height = isKeyboardVisible
      ? this._getKeyboardAdjustedViewportHeight(baseHeight, visualViewportHeight)
      : (visualViewportHeight ?? window.innerHeight);

    root.style.setProperty(CSS_VAR_VISUAL_VIEWPORT_HEIGHT, `${Math.max(0, height)}px`);
    root.style.setProperty(
      CSS_VAR_KEYBOARD_OVERLAY_OFFSET,
      `${isKeyboardVisible && !isVisualViewportAlreadyResized ? this._iosKeyboardHeight : 0}px`,
    );
    this._notifyIOSViewportChange();
  }

  private _getKeyboardAdjustedViewportHeight(
    baseHeight: number,
    visualViewportHeight?: number,
  ): number {
    const keyboardAdjustedHeight = baseHeight - this._iosKeyboardHeight;

    if (
      this._isVisualViewportResizedForKeyboard(true, baseHeight, visualViewportHeight)
    ) {
      return visualViewportHeight;
    }

    return keyboardAdjustedHeight;
  }

  private _isVisualViewportResizedForKeyboard(
    isKeyboardVisible: boolean,
    baseHeight: number,
    visualViewportHeight?: number,
  ): visualViewportHeight is number {
    return (
      isKeyboardVisible &&
      visualViewportHeight !== undefined &&
      visualViewportHeight < baseHeight - VIEWPORT_RESIZE_EPSILON_PX
    );
  }

  private _notifyIOSViewportChange(): void {
    if (this._iosViewportChangeRaf !== null) {
      return;
    }

    this._iosViewportChangeRaf = window.requestAnimationFrame(() => {
      this._iosViewportChangeRaf = null;
      // Connected CDK overlays listen to viewport resize events via ViewportRuler.
      window.dispatchEvent(new Event('resize'));
    });
  }

  private _isInputElement(el: HTMLElement): boolean {
    const tagName = el.tagName.toLowerCase();
    return (
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      el.isContentEditable
    );
  }

  private _scrollActiveInputIntoView(): void {
    const activeEl = this.document.activeElement as HTMLElement;
    if (activeEl && this._isInputElement(activeEl)) {
      // scrollIntoViewIfNeeded is non-standard but well-supported in iOS WebView
      if ('scrollIntoViewIfNeeded' in activeEl) {
        (activeEl as any).scrollIntoViewIfNeeded(true);
      } else {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  /**
   * Initialize mobile status bar styling.
   * Syncs status bar style with app dark/light mode on both iOS and Android.
   */
  /**
   * Read native safe area insets and set CSS variables.
   * Works around Capacitor 7's broken adjustMarginsForEdgeToEdge and
   * Android WebView's unreliable env(safe-area-inset-*) values.
   */
  private _initSafeAreaInsets(): void {
    const applyInsets = (insets: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    }): void => {
      const root = this.document.documentElement;
      root.style.setProperty(CSS_VAR_SAFE_AREA_TOP, `${insets.top}px`);
      root.style.setProperty(CSS_VAR_SAFE_AREA_BOTTOM, `${insets.bottom}px`);
      root.style.setProperty(CSS_VAR_SAFE_AREA_LEFT, `${insets.left}px`);
      root.style.setProperty(CSS_VAR_SAFE_AREA_RIGHT, `${insets.right}px`);
    };

    SafeArea.getSafeAreaInsets().then(({ insets }) => applyInsets(insets));
    SafeArea.addListener('safeAreaChanged', ({ insets }) => applyInsets(insets));
    this._patchCdkViewportForSafeArea();
  }

  /**
   * Monkey-patch CDK's viewport rect calculation to include native mobile insets.
   * This keeps connected overlays (menus, selects, autocomplete panels) above
   * the safe areas and the iOS keyboard when the WebView does not shrink.
   */
  private _patchCdkViewportForSafeArea(): void {
    const proto = FlexibleConnectedPositionStrategy.prototype as any;
    const original = proto._getNarrowedViewportRect;
    const doc = this.document;
    proto._getNarrowedViewportRect = function (): {
      top: number;
      left: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
    } {
      const rect = original.call(this);
      const style = getComputedStyle(doc.documentElement);
      const safeTop = parseInt(style.getPropertyValue(CSS_VAR_SAFE_AREA_TOP), 10) || 0;
      const safeBottom =
        parseInt(style.getPropertyValue(CSS_VAR_SAFE_AREA_BOTTOM), 10) || 0;
      const keyboardOverlayOffset =
        doc.body.classList.contains(BodyClass.isIOS) &&
        doc.body.classList.contains(BodyClass.isKeyboardVisible)
          ? parseInt(style.getPropertyValue(CSS_VAR_KEYBOARD_OVERLAY_OFFSET), 10) || 0
          : 0;
      const bottomInset = safeBottom + keyboardOverlayOffset;
      return {
        ...rect,
        top: rect.top + safeTop,
        bottom: rect.bottom - bottomInset,
        height: rect.height - safeTop - bottomInset,
      };
    };
  }

  private _initMobileStatusBar(): void {
    effect(() => {
      const isDark = this.isDarkTheme();
      StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch((err) => {
        Log.warn('Failed to set status bar style', err);
      });
      if (this._platformService.isAndroid()) {
        const bgColor = isDark ? '#131314' : '#f8f8f7';
        StatusBar.setBackgroundColor({ color: bgColor }).catch((err) => {
          Log.warn('Failed to set status bar background color', err);
        });
        NavigationBar.setColor({
          color: bgColor,
          style: isDark ? 'DARK' : 'LIGHT',
        }).catch((err) => {
          Log.warn('Failed to set navigation bar color', err);
        });
      }
    });
  }
}
