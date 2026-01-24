import {
  APP_INITIALIZER,
  enableProdMode,
  ErrorHandler,
  importProvidersFrom,
  provideZonelessChangeDetection,
  SecurityContext,
} from '@angular/core';
import { registerLocaleData } from '@angular/common';

import { environment } from './environments/environment';
import { IS_ELECTRON } from './app/app.constants';
import { DEFAULT_LANGUAGE, LocalesImports } from './app/core/locale.constants';
import { IS_ANDROID_WEB_VIEW } from './app/util/is-android-web-view';
import { androidInterface } from './app/features/android/android-interface';
import { IS_IOS_NATIVE, IS_NATIVE_PLATFORM } from './app/util/is-native-platform';
// Type definitions for window.ea are in ./app/core/window-ea.d.ts
import { App as CapacitorApp } from '@capacitor/app';
import { GlobalErrorHandler } from './app/core/error-handler/global-error-handler.class';
import { bootstrapApplication, BrowserModule } from '@angular/platform-browser';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { MarkdownModule, MARKED_OPTIONS, provideMarkdown, SANITIZE } from 'ngx-markdown';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { FeatureStoresModule } from './app/root-store/feature-stores.module';
import { MATERIAL_ANIMATIONS, MatNativeDateModule } from '@angular/material/core';
import { FormlyConfigModule } from './app/ui/formly-config.module';
import { markedOptionsFactory } from './app/ui/marked-options-factory';
import { MaterialCssVarsModule } from 'angular-material-css-vars';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { ReminderModule } from './app/features/reminder/reminder.module';
import { provideAnimations } from '@angular/platform-browser/animations';
import {
  PreloadAllModules,
  provideRouter,
  withHashLocation,
  withPreloading,
} from '@angular/router';
import { APP_ROUTES } from './app/app.routes';
import { StoreModule } from '@ngrx/store';
import { META_REDUCERS } from './app/root-store/meta/meta-reducer-registry';
import { setOperationCaptureService } from './app/root-store/meta/task-shared-meta-reducers';
import { OperationCaptureService } from './app/op-log/capture/operation-capture.service';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { ReactiveFormsModule } from '@angular/forms';
import { ServiceWorkerModule } from '@angular/service-worker';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import {
  TRANSLATE_HTTP_LOADER_CONFIG,
  TranslateHttpLoader,
} from '@ngx-translate/http-loader';
import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import { AppComponent } from './app/app.component';
import { ShortTimeHtmlPipe } from './app/ui/pipes/short-time-html.pipe';
import { ShortTimePipe } from './app/ui/pipes/short-time.pipe';
import { BackgroundTask } from '@capawesome/capacitor-background-task';
import { promiseTimeout } from './app/util/promise-timeout';
import { PLUGIN_INITIALIZER_PROVIDER } from './app/plugins/plugin-initializer';
import { initializeMatMenuTouchFix } from './app/features/tasks/task-context-menu/mat-menu-touch-monkey-patch';
import { Log } from './app/core/log';
import { GlobalConfigService } from './app/features/config/global-config.service';
import { LocaleDatePipe } from './app/ui/pipes/locale-date.pipe';

if (environment.production || environment.stage) {
  enableProdMode();
}

// Window.ea declaration is in src/app/core/window-ea.d.ts

bootstrapApplication(AppComponent, {
  providers: [
    // Provide configuration for TranslateHttpLoader
    {
      provide: TRANSLATE_HTTP_LOADER_CONFIG,
      useValue: {
        prefix: './assets/i18n/',
        suffix: '.json',
      },
    },
    importProvidersFrom(
      FeatureStoresModule,
      MatNativeDateModule,
      FormlyConfigModule,
      MarkdownModule.forRoot({
        markedOptions: {
          provide: MARKED_OPTIONS,
          useFactory: markedOptionsFactory,
        },
        sanitize: { provide: SANITIZE, useValue: SecurityContext.HTML },
      }),
      MaterialCssVarsModule.forRoot(),
      MatSidenavModule,
      MatBottomSheetModule,
      ReminderModule,
      MaterialCssVarsModule.forRoot(),
      // External
      BrowserModule,
      // NOTE: both need to be present to use forFeature stores
      // Meta-reducers are defined in meta-reducer-registry.ts with detailed phase documentation
      StoreModule.forRoot(undefined, {
        metaReducers: META_REDUCERS,
        ...(environment.production
          ? {
              runtimeChecks: {
                strictStateImmutability: false,
                strictActionImmutability: false,
                strictStateSerializability: false,
                strictActionSerializability: false,
              },
            }
          : {
              runtimeChecks: {
                strictStateImmutability: true,
                strictActionImmutability: true,
                strictStateSerializability: true,
                strictActionSerializability: true,
                strictActionTypeUniqueness: true,
              },
            }),
      }),
      EffectsModule.forRoot([]),
      !environment.production && !environment.stage
        ? StoreDevtoolsModule.instrument({
            maxAge: 15,
            logOnly: environment.production,
            actionsBlocklist: ['[TimeTracking] Add time spent'],
          })
        : [],
      ReactiveFormsModule,
      ServiceWorkerModule.register('ngsw-worker.js', {
        enabled:
          !IS_ELECTRON &&
          !IS_NATIVE_PLATFORM &&
          (environment.production || environment.stage),
        // Register the ServiceWorker as soon as the application is stable
        // or after 30 seconds (whichever comes first).
        registrationStrategy: 'registerWhenStable:30000',
      }),
      TranslateModule.forRoot({
        fallbackLang: DEFAULT_LANGUAGE,
        loader: {
          provide: TranslateLoader,
          useClass: TranslateHttpLoader,
        },
      }),
      CdkDropListGroup,
    ),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideHttpClient(withInterceptorsFromDi()),
    LocaleDatePipe,
    ShortTimeHtmlPipe,
    ShortTimePipe,
    provideMarkdown(),
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'fill', subscriptSizing: 'dynamic' },
    },
    provideAnimations(),
    {
      provide: MATERIAL_ANIMATIONS,
      deps: [GlobalConfigService],
      useFactory: (globalConfigService: GlobalConfigService) => ({
        get animationsDisabled(): boolean {
          return globalConfigService.misc()?.isDisableAnimations ?? false;
        },
      }),
    },
    provideRouter(APP_ROUTES, withHashLocation(), withPreloading(PreloadAllModules)),
    PLUGIN_INITIALIZER_PROVIDER,
    provideZonelessChangeDetection(),
    // Initialize operation capture service for synchronous state change capture
    // This must run before any persistent actions are dispatched
    {
      provide: APP_INITIALIZER,
      useFactory: (captureService: OperationCaptureService) => {
        return () => {
          setOperationCaptureService(captureService);
        };
      },
      deps: [OperationCaptureService],
      multi: true,
    },
    // Note: ImmediateUploadService now initializes itself in constructor
    // after DataInitStateService.isAllDataLoadedInitially$ fires to avoid
    // race condition where upload attempts happen before sync config is loaded
  ],
}).then(() => {
  // Initialize touch fix for Material menus
  initializeMatMenuTouchFix();

  // Register default locale immediately for fast startup
  registerLocaleData(LocalesImports[DEFAULT_LANGUAGE], DEFAULT_LANGUAGE);

  // Defer other locales to idle time for better initial load performance
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => {
      Object.keys(LocalesImports).forEach((locale) => {
        if (locale !== DEFAULT_LANGUAGE) {
          registerLocaleData(LocalesImports[locale], locale);
        }
      });
    });
  } else {
    // Fallback for browsers without requestIdleCallback
    setTimeout(() => {
      Object.keys(LocalesImports).forEach((locale) => {
        if (locale !== DEFAULT_LANGUAGE) {
          registerLocaleData(LocalesImports[locale], locale);
        }
      });
    }, 0);
  }

  // TODO make asset caching work for electron

  if (
    'serviceWorker' in navigator &&
    (environment.production || environment.stage) &&
    !IS_ELECTRON &&
    !IS_NATIVE_PLATFORM
  ) {
    Log.log('Registering Service worker');
    return navigator.serviceWorker.register('ngsw-worker.js').catch((err: unknown) => {
      Log.log('Service Worker Registration Error');
      Log.err(err);
    });
  } else if ('serviceWorker' in navigator && (IS_ELECTRON || IS_NATIVE_PLATFORM)) {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const registration of registrations) {
          registration.unregister();
        }
      })
      .catch((e) => {
        Log.err('ERROR when unregistering service worker');
        Log.err(e);
      });
  }
  return undefined;
});

// fix mobile scrolling while dragging
window.addEventListener('touchmove', () => {});

if (!(environment.production || environment.stage) && IS_ANDROID_WEB_VIEW) {
  setTimeout(() => {
    androidInterface.showToast('Android DEV works');
    Log.log(androidInterface);
  }, 1000);
}

// CAPACITOR STUFF
// ---------------

// Android-specific: Handle back button
if (IS_ANDROID_WEB_VIEW) {
  CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    if (!canGoBack) {
      CapacitorApp.minimizeApp();
    } else {
      window.history.back();
    }
  });
}

// Android: Handle app state changes with background task for sync completion
if (IS_ANDROID_WEB_VIEW) {
  CapacitorApp.addListener('appStateChange', async ({ isActive }) => {
    if (isActive) {
      return;
    }
    // The app state has been changed to inactive.
    // Start the background task by calling `beforeExit`.
    const taskId = await BackgroundTask.beforeExit(async () => {
      // Run your code...
      // Finish the background task as soon as everything is done.
      Log.log('Time window for completing sync started');
      await promiseTimeout(20000);
      Log.log('Time window for completing sync ended. Closing app!');
      BackgroundTask.finish({ taskId });
    });
  });
}

// iOS: Handle app state changes (limited background time)
if (IS_IOS_NATIVE) {
  CapacitorApp.addListener('appStateChange', async ({ isActive }) => {
    if (isActive) {
      Log.log('iOS app became active');
      return;
    }
    // iOS has limited background execution time (~30 seconds)
    // Log state change but don't attempt long-running tasks
    Log.log('iOS app going to background');
  });

  // Handle app URL open (for OAuth callbacks, deep links, etc.)
  CapacitorApp.addListener('appUrlOpen', (event) => {
    Log.log('iOS app URL open', event.url);
    // Handle OAuth callbacks or deep links here
    // The URL will be passed to the app when opened via custom scheme
  });
}
