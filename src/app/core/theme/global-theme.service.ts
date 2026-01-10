import {
  effect,
  EnvironmentInjector,
  inject,
  Injectable,
  runInInjectionContext,
  signal,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
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
  private _environmentInjector = inject(EnvironmentInjector);
  private _hasInitialized = false;

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
      ['play', 'assets/icons/play.svg'],
      ['github', 'assets/icons/github.svg'],
      ['gitlab', 'assets/icons/gitlab.svg'],
      ['jira', 'assets/icons/jira.svg'],
      ['logseq', 'assets/icons/logseq.svg'],
      ['caldav', 'assets/icons/caldav.svg'],
      ['open_project', 'assets/icons/open-project.svg'],
      ['drag_handle', 'assets/icons/drag-handle.svg'],
      ['remove_today', 'assets/icons/remove-today-48px.svg'],
      ['estimate_remaining', 'assets/icons/estimate-remaining.svg'],
      ['working_today', 'assets/icons/working-today.svg'],
      ['repeat', 'assets/icons/repeat.svg'],
      ['gitea', 'assets/icons/gitea.svg'],
      ['redmine', 'assets/icons/redmine.svg'],
      ['linear', 'assets/icons/linear.svg'],
      ['clickup', 'assets/icons/clickup.svg'],
      // trello icon
      ['trello', 'assets/icons/trello.svg'],
      ['calendar', 'assets/icons/calendar.svg'],
      ['early_on', 'assets/icons/early-on.svg'],
      ['tomorrow', 'assets/icons/tomorrow.svg'],
      ['next_week', 'assets/icons/next-week.svg'],
      ['keep', 'assets/icons/keep.svg'],
      ['keep_filled', 'assets/icons/keep-filled.svg'],
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
    this._workContextService.currentTheme$.subscribe((theme: WorkContextThemeCfg) =>
      this._setColorTheme(theme),
    );
    this._isDarkThemeObs$.subscribe((isDarkTheme) => this._setDarkTheme(isDarkTheme));

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

    if (IS_ANDROID_WEB_VIEW) {
      androidInterface.isKeyboardShown$.subscribe((isShown) => {
        Log.log('isShown', isShown);

        this.document.body.classList.remove(BodyClass.isAndroidKeyboardHidden);
        this.document.body.classList.remove(BodyClass.isAndroidKeyboardShown);
        this.document.body.classList.add(
          isShown ? BodyClass.isAndroidKeyboardShown : BodyClass.isAndroidKeyboardHidden,
        );
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

    this._imexMetaService.isDataImportInProgress$.subscribe((isInProgress) => {
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
}
