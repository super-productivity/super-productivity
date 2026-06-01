import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Log } from '../log';
import { DEFAULT_LANGUAGE } from '../locale.constants';
import EN_TRANSLATIONS from '../../../assets/i18n/en.json';

/**
 * TranslateLoader that degrades gracefully when the translation JSON cannot be
 * fetched because of a transient network failure (`HttpErrorResponse` with
 * `status === 0`).
 *
 * This is the offline / Safari-Reading-List case from issue #7854: the HTML is
 * served from a cache that bypasses the service worker, so the relative
 * `GET ./assets/i18n/<lang>.json` never completes and Angular surfaces it as a
 * status-0 error. The stock {@link TranslateHttpLoader} has no fallback, so the
 * rejection reaches the GlobalErrorHandler and the app shows a crash card
 * instead of booting.
 *
 * On a status-0 failure we fall back to the English translations bundled at
 * build time so the app boots with readable text rather than a crash card or
 * raw translation keys, and self-heals once a cached or online copy is
 * available. Any other failure (e.g. a 404 or a JSON parse error, which
 * indicate a genuine deployment problem rather than being offline) is rethrown
 * so it stays visible.
 *
 * The inner {@link TranslateHttpLoader} is created in this provider's injection
 * context, so its constructor `inject(TRANSLATE_HTTP_LOADER_CONFIG)` resolves
 * the same prefix/suffix config the app already provides.
 */
@Injectable({ providedIn: 'root' })
export class TranslateHttpLoaderWithFallback implements TranslateLoader {
  private _httpLoader = new TranslateHttpLoader();

  getTranslation(lang: string): Observable<TranslationObject> {
    return this._httpLoader.getTranslation(lang).pipe(
      catchError((err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 0) {
          // Expected, recoverable offline degrade — warn, don't err.
          Log.warn(
            `Translation file for "${lang}" could not be loaded (offline?). ` +
              `Falling back to bundled English translations so the app can still boot.`,
          );
          return of(this._getFallbackTranslations(lang));
        }
        throw err;
      }),
    );
  }

  /**
   * Bundled English baseline for the offline fallback. For non-English
   * languages we still return English (the only language bundled): English is
   * the source language with complete key coverage, so it is the best readable
   * fallback. An empty map for `en` itself would only ever yield raw keys.
   */
  private _getFallbackTranslations(lang: string): TranslationObject {
    if (lang !== DEFAULT_LANGUAGE) {
      Log.warn(
        `No bundled translations for "${lang}"; using bundled "${DEFAULT_LANGUAGE}" as fallback.`,
      );
    }
    return EN_TRANSLATIONS as TranslationObject;
  }
}
