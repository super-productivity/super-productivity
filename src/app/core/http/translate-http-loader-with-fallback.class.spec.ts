import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  TRANSLATE_HTTP_LOADER_CONFIG,
  TranslateHttpLoaderConfig,
} from '@ngx-translate/http-loader';
import { TranslateHttpLoaderWithFallback } from './translate-http-loader-with-fallback.class';
import EN_TRANSLATIONS from '../../../assets/i18n/en.json';

describe('TranslateHttpLoaderWithFallback', () => {
  let loader: TranslateHttpLoaderWithFallback;
  let httpMock: HttpTestingController;

  const CONFIG: TranslateHttpLoaderConfig = {
    prefix: './assets/i18n/',
    suffix: '.json',
    enforceLoading: false,
    useHttpBackend: false,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TRANSLATE_HTTP_LOADER_CONFIG, useValue: CONFIG },
        TranslateHttpLoaderWithFallback,
      ],
    });
    loader = TestBed.inject(TranslateHttpLoaderWithFallback);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('returns the parsed translations on success', (done) => {
    // `unknown` avoids the deep recursive `TranslationObject` type blowing up inference.
    loader.getTranslation('en').subscribe((res: unknown) => {
      expect(res).toEqual({ HELLO: 'Hello' });
      done();
    });

    httpMock.expectOne('./assets/i18n/en.json').flush({ HELLO: 'Hello' });
  });

  it('falls back to bundled English on a status-0 (offline) error', (done) => {
    loader.getTranslation('en').subscribe({
      next: (res: unknown) => {
        // The whole bundled en.json is returned so the app boots with readable
        // text rather than raw keys.
        expect(res).toBe(EN_TRANSLATIONS as unknown as object);
        done();
      },
      error: () => done.fail('should not error on a status-0 failure'),
    });

    httpMock
      .expectOne('./assets/i18n/en.json')
      .error(new ProgressEvent('error'), { status: 0, statusText: '' });
  });

  it('falls back to bundled English even for a non-English language on a status-0 error', (done) => {
    loader.getTranslation('de').subscribe({
      next: (res: unknown) => {
        expect(res).toBe(EN_TRANSLATIONS as unknown as object);
        done();
      },
      error: () => done.fail('should not error on a status-0 failure'),
    });

    httpMock
      .expectOne('./assets/i18n/de.json')
      .error(new ProgressEvent('error'), { status: 0, statusText: '' });
  });

  it('rethrows non-status-0 errors (e.g. 404) so real deploy issues stay visible', (done) => {
    loader.getTranslation('en').subscribe({
      next: () => done.fail('should not emit a value on a 404'),
      error: (err: unknown) => {
        expect(err).toBeInstanceOf(HttpErrorResponse);
        expect((err as HttpErrorResponse).status).toBe(404);
        done();
      },
    });

    httpMock
      .expectOne('./assets/i18n/en.json')
      .flush('Not found', { status: 404, statusText: 'Not Found' });
  });
});
