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
import { BodyClass, IS_ELECTRON } from '../../app.constants';
import { IS_MAC } from '../../util/is-mac';
import { distinctUntilChanged, map, startWith, switchMap, take } from 'rxjs/operators';
import { IS_TOUCH_ONLY } from '../../util/is-touch-only';
import { MaterialCssVarsService } from 'angular-material-css-vars';
import { DOCUMENT } from '@angular/common';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { ChromeExtensionInterfaceService } from '../chrome-extension-interface/chrome-extension-interface.service';
import { ThemeService as NgChartThemeService } from 'ng2-charts';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { WorkContextThemeCfg } from '../../features/work-context/work-context.model';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { combineLatest, fromEvent, Observable, of } from 'rxjs';
import { IS_FIREFOX } from '../../util/is-firefox';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { IS_MOUSE_PRIMARY, IS_TOUCH_PRIMARY } from '../../util/is-mouse-primary';
import { ChartConfiguration } from 'chart.js';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { androidInterface } from '../../features/android/android-interface';
import { HttpClient } from '@angular/common/http';
import { CapacitorPlatformService } from '../platform/capacitor-platform.service';
import { Keyboard, KeyboardInfo } from '@capacitor/keyboard';
import { PluginListenerHandle } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SafeArea } from 'capacitor-plugin-safe-area';
import { FlexibleConnectedPositionStrategy } from '@angular/cdk/overlay';
import { LS } from '../persistence/storage-keys.const';
import { CustomThemeService } from './custom-theme.service';
import { Log } from '../log';
import { LayoutService } from '../../core-ui/layout/layout.service';

export type DarkModeCfg = 'dark' | 'light' | 'system';

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
  private _chartThemeService = inject(NgChartThemeService);
  private _chromeExtensionInterfaceService = inject(ChromeExtensionInterfaceService);
  private _imexMetaService = inject(ImexViewService);
  private _http = inject(HttpClient);
  private _customThemeService = inject(CustomThemeService);
  private _platformService = inject(CapacitorPlatformService);
  private _environmentInjector = inject(EnvironmentInjector);
  private _destroyRef = inject(DestroyRef);
  private _hasInitialized = false;
  private _keyboardListenerHandles: PluginListenerHandle[] = [];
  private _focusinListener: ((event: FocusEvent) => void) | null = null;

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
    this._setChartTheme(isDarkTheme);
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
        // Use untracked to prevent reading misc from creating a dependency
        const misc = untracked(() => this._globalConfigService.misc());
        // Only update if custom window title bar is enabled
        if (misc?.isUseCustomWindowTitleBar !== false) {
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
      const misc = this._globalConfigService.misc();
      if (misc?.isUseCustomWindowTitleBar !== false) {
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

    if (IS_MOUSE_PRIMARY) {
      this.document.body.classList.add(BodyClass.isMousePrimary);
    } else if (IS_TOUCH_PRIMARY) {
      this.document.body.classList.add(BodyClass.isTouchPrimary);
    }
  }

  private _setChartTheme(isDarkTheme: boolean): void {
    const overrides: ChartConfiguration['options'] = isDarkTheme
      ? {
          // legend: {
          //   labels: { fontColor: 'white' },
          // },
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
    this._chartThemeService.setColorschemesOptions(overrides);
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
    Keyboard.addListener('keyboardWillShow', (info: KeyboardInfo) => {
      Log.log('iOS keyboard will show', info);
      this.document.body.classList.add(BodyClass.isKeyboardVisible);
      // Set CSS variable for keyboard height to adjust layout
      this.document.documentElement.style.setProperty(
        '--keyboard-height',
        `${info.keyboardHeight}px`,
      );
    }).then((handle) => this._keyboardListenerHandles.push(handle));

    // Use keyboardDidShow for scroll (after animation completes)
    Keyboard.addListener('keyboardDidShow', () => {
      this._scrollActiveInputIntoView();
    }).then((handle) => this._keyboardListenerHandles.push(handle));

    Keyboard.addListener('keyboardWillHide', () => {
      Log.log('iOS keyboard will hide');
      this.document.body.classList.remove(BodyClass.isKeyboardVisible);
      this.document.documentElement.style.setProperty('--keyboard-height', '0px');
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
      if (this._focusinListener) {
        this.document.removeEventListener('focusin', this._focusinListener);
      }
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
      root.style.setProperty('--safe-area-inset-top', `${insets.top}px`);
      root.style.setProperty('--safe-area-inset-bottom', `${insets.bottom}px`);
      root.style.setProperty('--safe-area-inset-left', `${insets.left}px`);
      root.style.setProperty('--safe-area-inset-right', `${insets.right}px`);
    };

    SafeArea.getSafeAreaInsets().then(({ insets }) => applyInsets(insets));
    SafeArea.addListener('safeAreaChanged', ({ insets }) => applyInsets(insets));
    this._patchCdkViewportForSafeArea();
  }

  /**
   * Monkey-patch CDK's viewport rect calculation to include safe area insets.
   * This makes connected overlays (menus, selects) stay within the safe area
   * instead of extending behind the status bar or home indicator.
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
      const safeTop = parseInt(style.getPropertyValue('--safe-area-inset-top'), 10) || 0;
      const safeBottom =
        parseInt(style.getPropertyValue('--safe-area-inset-bottom'), 10) || 0;
      return {
        ...rect,
        top: rect.top + safeTop,
        bottom: rect.bottom - safeBottom,
        height: rect.height - safeTop - safeBottom,
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
        StatusBar.setBackgroundColor({ color: isDark ? '#131314' : '#f8f8f7' }).catch(
          (err) => {
            Log.warn('Failed to set status bar background color', err);
          },
        );
      }
    });
  }
}
