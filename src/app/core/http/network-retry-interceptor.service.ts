import { Injectable } from '@angular/core';
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable, throwError, timer } from 'rxjs';
import { retry } from 'rxjs/operators';

/** Short backoff — long enough for the WebView's socket reconnect, short enough to feel instant. */
const RETRY_DELAY_MS = 500;

/**
 * Retries GETs once on transient client-side network errors
 * (`HttpErrorResponse` with `status === 0`), which is how Angular surfaces
 * fetch failures from the browser network stack (ERR_NETWORK_CHANGED /
 * ERR_INTERNET_DISCONNECTED / ERR_NAME_NOT_RESOLVED). Catches the common
 * case of the WebView's sockets not being ready in the first few hundred ms
 * after Android/Electron resume. Non-GET requests are never retried — we do
 * not silently re-issue writes.
 */
@Injectable({ providedIn: 'root' })
export class NetworkRetryInterceptorService implements HttpInterceptor {
  intercept(
    req: HttpRequest<unknown>,
    next: HttpHandler,
  ): Observable<HttpEvent<unknown>> {
    if (req.method !== 'GET') {
      return next.handle(req);
    }
    return next.handle(req).pipe(
      retry({
        count: 1,
        delay: (error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 0) {
            return timer(RETRY_DELAY_MS);
          }
          return throwError(() => error);
        },
      }),
    );
  }
}
