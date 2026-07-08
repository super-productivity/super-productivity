import { importProvidersFrom, provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatDialogModule } from '@angular/material/dialog';
import { MatNativeDateModule } from '@angular/material/core';
import { MaterialCssVarsModule } from 'angular-material-css-vars';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { TRANSLATE_HTTP_LOADER_CONFIG } from '@ngx-translate/http-loader';
import { TranslateHttpLoaderWithFallback } from './app/core/http/translate-http-loader-with-fallback.class';
import { DEFAULT_LANGUAGE, DEFAULT_LOCALE_DATA } from './app/core/locale.constants';
import { DEFAULT_TODAY_TAG_COLOR } from './app/features/work-context/work-context.const';
import { QuickAddRootComponent } from './app/features/tasks/add-task-bar/quick-add-root.component';
import { ADD_TASK_BAR_DATA_FACADE } from './app/features/tasks/add-task-bar/add-task-bar-data-facade.token';
import { QuickAddHudDataFacadeService } from './app/features/tasks/add-task-bar/quick-add-hud-data-facade.service';

document.documentElement.classList.add('isQuickAddHud');
document.body.classList.add('isQuickAddHud');
registerLocaleData(DEFAULT_LOCALE_DATA, DEFAULT_LANGUAGE);

void bootstrapApplication(QuickAddRootComponent, {
  providers: [
    {
      provide: TRANSLATE_HTTP_LOADER_CONFIG,
      useValue: {
        prefix: './assets/i18n/',
        suffix: '.json',
      },
    },
    QuickAddHudDataFacadeService,
    {
      provide: ADD_TASK_BAR_DATA_FACADE,
      useExisting: QuickAddHudDataFacadeService,
    },
    importProvidersFrom(
      MatDialogModule,
      MatNativeDateModule,
      MaterialCssVarsModule.forRoot({
        primary: DEFAULT_TODAY_TAG_COLOR,
      }),
      TranslateModule.forRoot({
        fallbackLang: DEFAULT_LANGUAGE,
        loader: {
          provide: TranslateLoader,
          useClass: TranslateHttpLoaderWithFallback,
        },
      }),
    ),
    provideHttpClient(withInterceptorsFromDi()),
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'fill', subscriptSizing: 'dynamic' },
    },
    provideAnimationsAsync(),
    provideZonelessChangeDetection(),
  ],
});
