import {
  computed,
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
import { BodyClass, IS_ELECTRON, IS_GNOME_WAYLAND } from '../../app.constants';
import { IS_MAC } from '../../util/is-mac';
import {
  distinctUntilChanged,
  filter,
  map,
  startWith,
  switchMap,
  take,
} from 'rxjs/operators';
import { NavigationEnd, Router } from '@angular/router';
import { IS_TOUCH_ONLY } from '../../util/is-touch-only';
import { MaterialCssVarsService } from 'angular-material-css-vars';
import { DOCUMENT } from '@angular/common';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { ChromeExtensionInterfaceService } from '../chrome-extension-interface/chrome-extension-interface.service';

import { GlobalConfigService } from '../../features/config/global-config.service';
import { WorkContextThemeCfg } from '../../features/work-context/work-context.model';
import {
  DEFAULT_BACKGROUND_OVERLAY_OPACITY,
  isBackgroundImageSet,
  normalizeBackgroundImageBlur,
} from '../../features/work-context/work-context.const';
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
import { Log } from '../log';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { sanitizeIosKeyboardHeight } from './sanitize-ios-keyboard-height.util';
import { CustomThemeService, getRequiredThemeMode } from './custom-theme.service';

interface NavigationBarPlugin {
  setColor(options: { color: string; style: 'LIGHT' | 'DARK' }): Promise<void>;
  setWebViewBackgroundColor(options: { color: string }): Promise<void>;
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
const CSS_VAR_SYSTEM_SURFACE = '--system-surface';
const VIEWPORT_RESIZE_EPSILON_PX = 1;
const DEFAULT_LIGHT_SYSTEM_SURFACE = '#f8f8f7';
const DEFAULT_DARK_SYSTEM_SURFACE = '#131314';

/**
 * Resolve a CSS theme surface to the opaque hex format Android's Color parser
 * accepts. Transparent, gradient, unresolved, and otherwise invalid values
 * fall back to the matching Default-theme surface.
 */
export const resolveSystemSurfaceColor = (
  rawColor: string,
  isDarkMode: boolean,
): string => {
  const color = rawColor.trim();
  const fallback = isDarkMode
    ? DEFAULT_DARK_SYSTEM_SURFACE
    : DEFAULT_LIGHT_SYSTEM_SURFACE;

  if (/^#[\da-f]{6}$/i.test(color)) {
    return color;
  }
  if (/^#[\da-f]{3}$/i.test(color)) {
    return `#${[...color.slice(1)].map((digit) => `${digit}${digit}`).join('')}`;
  }
  const rgbMatch = color.match(
    /^rgb\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})\s*\)$/i,
  );
  if (rgbMatch) {
    const channels = rgbMatch.slice(1).map(Number);
    if (channels.every((channel) => channel <= 255)) {
      return `#${channels
        .map((channel) => channel.toString(16).padStart(2, '0'))
        .join('')}`;
    }
  }
  return fallback;
};

/** The four wallpaper fields of the app-level (global) background config. */
export type GlobalWallpaperCfg = Pick<
  WorkContextThemeCfg,
  | 'backgroundImageDark'
  | 'backgroundImageLight'
  | 'backgroundOverlayOpacity'
  | 'backgroundImageBlur'
>;

export interface ResolvedBackground {
  /** The image to show, or null when no background applies to this URL. */
  imageUrl: string | null;
  /** Final CSS overlay opacity (0..0.99) of the resolved image's source. */
  overlayOpacity: number;
  /** Blur radius in px of the resolved image's source. */
  blur: number;
}

const _styleOf = (
  theme: GlobalWallpaperCfg,
): Pick<ResolvedBackground, 'overlayOpacity' | 'blur'> => ({
  overlayOpacity:
    (theme.backgroundOverlayOpacity ?? DEFAULT_BACKGROUND_OVERLAY_OPACITY) * 0.01,
  blur: normalizeBackgroundImageBlur(theme.backgroundImageBlur),
});

/**
 * Resolve which background image and styling apply to the current route.
 *
 * Precedence: per-context image → global wallpaper → none. Crucially, on
 * non-work-context routes (Planner, Schedule, Boards, Config, …) the active
 * work context stays "Today" (the reducer default), so we must never use its
 * image there — only the global wallpaper. The overlay-opacity and blur travel
 * with the resolved image so a global wallpaper is never styled by the sticky
 * context's settings.
 */
export const resolveBackground = (
  contextTheme: WorkContextThemeCfg,
  globalCfg: GlobalWallpaperCfg,
  isDarkMode: boolean,
  url: string,
): ResolvedBackground => {
  // Anchor to the path start so a query/fragment containing "/tag/" or
  // "/project/" can't misclassify a non-context route.
  const isWorkContextUrl = /^\/(tag|project)\//.test(url);
  const contextImg = isDarkMode
    ? contextTheme.backgroundImageDark
    : contextTheme.backgroundImageLight;

  if (isWorkContextUrl && isBackgroundImageSet(contextImg)) {
    return { imageUrl: contextImg, ..._styleOf(contextTheme) };
  }

  const globalImg = isDarkMode
    ? globalCfg.backgroundImageDark
    : globalCfg.backgroundImageLight;
  return {
    imageUrl: isBackgroundImageSet(globalImg) ? globalImg : null,
    ..._styleOf(globalCfg),
  };
};

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
  private _router = inject(Router);

  private _chromeExtensionInterfaceService = inject(ChromeExtensionInterfaceService);
  private _imexMetaService = inject(ImexViewService);
  private _http = inject(HttpClient);
  private _platformService = inject(CapacitorPlatformService);
  private _customThemeService = inject(CustomThemeService);
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
  // True only when the plugin reported an implausible keyboard frame (the clamp
  // had to correct it). Gates the measured-viewport override so well-behaved
  // keyboards keep their exact pre-existing behaviour (#8778).
  private _iosKeyboardFrameUnreliable = false;

  private _isCustomWindowTitleBarEnabled(): boolean {
    // The main process (main-window.ts) force-disables the custom title bar on
    // GNOME+Wayland because the Window-Controls-Overlay won't render there.
    // Mirror that here so we never lay the custom header on top of native
    // decorations, which would produce a doubled header.
    if (IS_GNOME_WAYLAND) {
      return false;
    }
    // Default ON to match main-window's `?? !IS_GNOME_WAYLAND` default.
    // KNOWN RESIDUAL: main-window also honors the legacy `isUseObsidianStyleHeader`
    // SimpleStore field, which is never mirrored into global config, so it isn't
    // visible here. A user who explicitly disabled the *old* header and never set
    // the new toggle gets native decorations + custom header (doubled). This is a
    // pre-existing divergence (already present for non-GNOME) and is self-healing:
    // the now-visible Misc toggle lets them turn the custom header off.
    const misc = this._globalConfigService.misc();
    return misc?.isUseCustomWindowTitleBar ?? true;
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

  // Emits the current URL after each completed navigation, starting with the
  // current URL so the stream is immediately available before any navigation.
  private _currentUrl$: Observable<string> = this._router.events.pipe(
    filter((e) => e instanceof NavigationEnd),
    map((e) => (e as NavigationEnd).urlAfterRedirects),
    startWith(this._router.url),
  );

  private _resolvedBackground$: Observable<ResolvedBackground> = combineLatest([
    this._workContextService.currentTheme$,
    this._isDarkThemeObs$,
    this._currentUrl$,
    this._globalConfigService.misc$,
  ]).pipe(
    map(([theme, isDarkMode, url, misc]) =>
      resolveBackground(theme, misc, isDarkMode, url),
    ),
    distinctUntilChanged(
      (a, b) =>
        a.imageUrl === b.imageUrl &&
        a.overlayOpacity === b.overlayOpacity &&
        a.blur === b.blur,
    ),
  );

  private _resolvedBackground = toSignal(this._resolvedBackground$, {
    initialValue: {
      imageUrl: null,
      overlayOpacity: DEFAULT_BACKGROUND_OVERLAY_OPACITY * 0.01,
      blur: 0,
    } satisfies ResolvedBackground,
  });

  /** The resolved background image URL for the current route (null if none). */
  readonly backgroundImg = computed(() => this._resolvedBackground().imageUrl);

  /** Final CSS overlay opacity for the resolved background image. */
  readonly bgOverlayOpacity = computed(() => this._resolvedBackground().overlayOpacity);

  /** Blur radius (px) for the resolved background image. */
  readonly bgImageBlur = computed(() => this._resolvedBackground().blur);

  init(): void {
    if (this._hasInitialized) {
      return;
    }
    this._hasInitialized = true;

    runInInjectionContext(this._environmentInjector, () => {
      // This is here to make web page reloads on non-work-context pages at least usable
      this._setBackgroundTint(true);
      this._initIcons();
      this._initRequiredThemeMode();
      this._initHandlersForInitialBodyClasses();
      this._initThemeWatchers();

      // Set up dark mode persistence effect
      effect(() => {
        const darkMode = this.darkMode();
        localStorage.setItem(LS.DARK_MODE, darkMode);
      });
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

  private _initRequiredThemeMode(): void {
    const enforceActiveThemeMode = (): void => {
      const requiredMode = getRequiredThemeMode(this._customThemeService.activeRef());
      if (requiredMode && this.darkMode() !== requiredMode) {
        this.darkMode.set(requiredMode);
      }
    };

    // Effects run during change detection; enforce once synchronously so the
    // cold-start stylesheet never waits a frame for its required body class.
    enforceActiveThemeMode();
    effect(enforceActiveThemeMode);
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
      ['gitea', 'assets/icons/gitea.svg'],
      ['redmine', 'assets/icons/redmine.svg'],
      ['linear', 'assets/icons/linear.svg'],
      ['clickup', 'assets/icons/clickup.svg'],
      // trello icon
      ['trello', 'assets/icons/trello.svg'],
      ['azure_devops', 'assets/icons/azure_devops.svg'],
      ['nextcloud_deck', 'assets/icons/nextcloud_deck.svg'],
      ['plainspace', 'assets/icons/plainspace.svg'],
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
        // The native OnGlobalLayoutListener pushes a value on every layout pass
        // (i.e. every frame of the IME slide), so dedupe to actual transitions —
        // otherwise we rewrite <body> classes and re-trigger change detection
        // every frame while the keyboard animates.
        .pipe(distinctUntilChanged(), takeUntilDestroyed(this._destroyRef))
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

    // VisualViewport keyboard-height tracking covers every non-iOS touch
    // build: Capacitor Android, the legacy F-Droid build, and Android
    // mobile-web. iOS uses _initIOSKeyboardHandling above; its Capacitor
    // plugin already drives the same CSS variable and the two would race.
    if (IS_TOUCH_ONLY && !this._platformService.isIOS()) {
      this._initVisualViewportKeyboardTracking();
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

    effect(() => {
      const misc = this._globalConfigService.misc();
      if (misc?.isVerticalActionBar) {
        this.document.body.classList.add(BodyClass.isVerticalActionBar);
      } else {
        this.document.body.classList.remove(BodyClass.isVerticalActionBar);
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

  /**
   * Initialize iOS keyboard visibility tracking using Capacitor Keyboard plugin.
   * Adds/removes CSS classes when keyboard shows/hides.
   */
  private _initIOSKeyboardHandling(): void {
    // Hide the native iOS accessory bar (prev/next/Done) — no multi-field forms
    // benefit from it, and Done is redundant with the system dismiss gesture.
    Keyboard.setAccessoryBarVisible({ isVisible: false });
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
      // Some third-party keyboards (e.g. Sogou) report a bogus near-full-screen
      // keyboard frame here; clamp it so it can't fling the fixed add-task bar
      // to the top of the screen (#8778).
      const referenceHeight = this._iosViewportHeightBeforeKeyboard || window.innerHeight;
      const keyboardHeight = sanitizeIosKeyboardHeight(
        info.keyboardHeight,
        referenceHeight,
      );
      // Only a frame the clamp had to correct opts into the measured-viewport
      // override in _updateIOSKeyboardViewportVars; well-behaved keyboards keep
      // the exact pre-existing behaviour, so this cannot regress them.
      this._iosKeyboardFrameUnreliable = keyboardHeight !== info.keyboardHeight;
      this._iosKeyboardHeight = keyboardHeight;
      this.document.body.classList.add(BodyClass.isKeyboardVisible);
      // Set CSS variable for keyboard height to adjust layout
      this.document.documentElement.style.setProperty(
        CSS_VAR_KEYBOARD_HEIGHT,
        `${keyboardHeight}px`,
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
      this._iosKeyboardFrameUnreliable = false;
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

    // For a keyboard whose reported frame was implausible, once the viewport has
    // actually shrunk its measured obscured area (`baseHeight -
    // visualViewportHeight`) is a far more reliable keyboard height than the
    // bogus plugin frame (#8778), and is correct under both `resize: 'native'`
    // and non-resizing modes. Correct `--keyboard-height` to the measurement
    // (still clamped as a safety net). Well-behaved keyboards skip this entirely
    // and keep the plugin value set in keyboardWillShow — no behaviour change.
    if (
      this._iosKeyboardFrameUnreliable &&
      this._isVisualViewportResizedForKeyboard(
        isKeyboardVisible,
        baseHeight,
        visualViewportHeight,
      )
    ) {
      root.style.setProperty(
        CSS_VAR_KEYBOARD_HEIGHT,
        `${sanitizeIosKeyboardHeight(baseHeight - visualViewportHeight, baseHeight)}px`,
      );
    }
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

  /**
   * Keyboard-height tracking via VisualViewport — the fallback path for any
   * non-iOS touch build (Capacitor Android, F-Droid, mobile-web).
   *
   * Android's `adjustResize` is supposed to shrink the WebView when the IME
   * appears, in which case `position: fixed; bottom: 0` would naturally sit
   * above the keyboard. In practice it's inconsistent — depending on Chrome
   * version, transient transitions, and edge-to-edge insets, the layout
   * viewport sometimes does not shrink in step with the keyboard, leaving
   * fixed-position UI hidden behind it.
   *
   * VisualViewport always reflects the actual visible area. The difference
   * `window.innerHeight - visualViewport.height` is the obscured area —
   * which is zero when adjustResize already handled it, and equals the
   * keyboard height otherwise. Either way, `--keyboard-height` ends up
   * correct without needing to know which path Android took.
   */
  private _initVisualViewportKeyboardTracking(): void {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = this.document.documentElement;
    // Filter out small differences from URL bar / overlay UI rather than the
    // IME — keeps us from setting a phantom keyboard offset.
    const KEYBOARD_THRESHOLD_PX = 100;
    // IME open/close on Android resizes the layout viewport (adjustResize)
    // and the visual viewport at slightly different times, so per-event
    // commits park fixed-position UI (e.g. the global add-task bar) at
    // intermediate partial-keyboard amounts. Debounce the OPEN path so only
    // the final value lands (200ms, just past `--transition-duration-m`:
    // 225ms). Commit the CLOSE path synchronously so the bar drops the moment
    // the IME is gone rather than parking at the old height for the debounce
    // window — that would just invert the original symptom.
    const KEYBOARD_RESIZE_DEBOUNCE_MS = 200;
    let resizeTimer: number | null = null;

    const commit = (): void => {
      const obscured = window.innerHeight - vv.height;
      const keyboardHeight = obscured > KEYBOARD_THRESHOLD_PX ? obscured : 0;
      root.style.setProperty(CSS_VAR_KEYBOARD_HEIGHT, `${keyboardHeight}px`);
    };

    const onViewportResize = (): void => {
      const obscured = window.innerHeight - vv.height;
      if (obscured <= KEYBOARD_THRESHOLD_PX) {
        if (resizeTimer !== null) {
          window.clearTimeout(resizeTimer);
          resizeTimer = null;
        }
        commit();
        return;
      }
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        commit();
      }, KEYBOARD_RESIZE_DEBOUNCE_MS);
    };

    commit();
    vv.addEventListener('resize', onViewportResize, { passive: true });
    this._destroyRef.onDestroy(() => {
      vv.removeEventListener('resize', onViewportResize);
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
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
   * Works around Android WebView's unreliable env(safe-area-inset-*) values.
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

    // On Android the WebView now draws edge-to-edge (the @capawesome plugin that
    // used to inset it via native margins was removed in favour of Capacitor's
    // built-in SystemBars). The --safe-area-inset-* vars are no longer written
    // from JS on Android — that would race SystemBars on the same documentElement
    // inline style (last-writer-wins, OS/timing dependent). Each band resolves
    // them on its own (verified against the bundled SystemBars.java):
    //   - API >= 35: SystemBars *injects* the real px into --safe-area-inset-*.
    //   - WebView >= 140 (any API): SystemBars passes the native insets through,
    //     so the WebView's own env(safe-area-inset-*) is correct (no injection
    //     below API 35).
    //   - WebView < 140 / API < 35 tail: SystemBars does nothing here.
    // In every case the SCSS fallback `var(--safe-area-inset-*, env(...))` in
    // _css-variables.scss resolves to the injected px when present, else to
    // env(). With viewport-fit=cover env(safe-area-inset-top) equals the
    // status-bar height when the WebView extends under it — exactly the #8283 top
    // fallback, preserved automatically by not pinning the var here.
    // Only iOS (contentInset: 'never') still needs JS-fed insets from
    // capacitor-plugin-safe-area; SystemBars insetsHandling is Android-only.
    if (!this._platformService.isAndroid()) {
      SafeArea.getSafeAreaInsets().then(({ insets }) => applyInsets(insets));
      SafeArea.addListener('safeAreaChanged', ({ insets }) => applyInsets(insets));
    }
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
      // Re-read computed tokens only after the loader has atomically swapped
      // the stylesheet. Theme changes do not necessarily change dark mode.
      this._customThemeService.appliedThemeVersion();
      StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch((err) => {
        Log.warn('Failed to set status bar style', err);
      });
      if (this._platformService.isAndroid()) {
        const bgColor = resolveSystemSurfaceColor(
          getComputedStyle(this.document.body).getPropertyValue(CSS_VAR_SYSTEM_SURFACE),
          isDark,
        );
        // The @capawesome edge-to-edge plugin (which painted opaque bar overlays
        // via EdgeToEdge.set{Status,Navigation}BarColor) was removed in favour of
        // Capacitor's built-in SystemBars. SystemBars has NO bar-color API — the
        // edge-to-edge model is transparent bars with the web content drawn
        // behind them. The bar backgrounds are therefore painted by:
        //   - setWebViewBackgroundColor below (window decor + WebView surface),
        //     which shows through the transparent bars (the color backstop on
        //     API 35+ where window.*BarColor is a no-op), and
        //   - NavigationBar.setColor's window.navigationBarColor, still effective
        //     on API < 35, plus its setSystemBarsAppearance which drives the nav
        //     bar icon light/dark on all versions.
        // Status-bar icon light/dark is set via StatusBar.setStyle above.
        NavigationBar.setColor({
          color: bgColor,
          style: isDark ? 'DARK' : 'LIGHT',
        }).catch((err) => {
          Log.warn('Failed to set navigation bar appearance', err);
        });
        // Paint the WebView surface and window decor with the theme background so
        // the transparent system bars show the theme color behind them and the
        // keyboard animation can't flash white between frames.
        NavigationBar.setWebViewBackgroundColor({ color: bgColor }).catch((err) => {
          Log.warn('Failed to set web view background color', err);
        });
      }
    });
  }
}
