import { inject, Injectable } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { GlobalProgressBarService } from './global-progress-bar.service';

const SYNC_URL_PATTERNS = [
  'dropboxapi.com',
  '/sync/',
  '/ops',
  '/snapshot',
  '/restore-points',
];

@Injectable({ providedIn: 'root' })
export class GlobalProgressBarInterceptorService implements HttpInterceptor {
  private globalProgressBarService = inject(GlobalProgressBarService);

  constructor() {}

  intercept(
    req: HttpRequest<unknown>,
    next: HttpHandler,
  ): Observable<HttpEvent<unknown>> {
    const isSyncUrl = this._isSyncUrl(req.url);
    if (!isSyncUrl) {
      this.globalProgressBarService.countUp(req.url);
    }
    return next.handle(req).pipe(
      finalize(() => {
        if (!isSyncUrl) {
          this.globalProgressBarService.countDown();
        }
      }),
    );
  }

  private _isSyncUrl(url: string): boolean {
    return SYNC_URL_PATTERNS.some((pattern) => url.includes(pattern));
  }
}
