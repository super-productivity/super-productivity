import { Pipe, PipeTransform, inject } from '@angular/core';
import { ClipboardImageService } from './clipboard-image.service';
import { Observable, from, of, defer } from 'rxjs';
import { map, shareReplay, catchError } from 'rxjs/operators';

@Pipe({
  name: 'resolveClipboardUrl',
  standalone: true,
})
export class ResolveClipboardUrlPipe implements PipeTransform {
  private readonly _clipboardImageService = inject(ClipboardImageService);
  private readonly _cache = new Map<string, Observable<string>>();

  transform(url: string | undefined | null): Observable<string> {
    if (!url) {
      return of('');
    }

    // If it's not an indexeddb URL, return as-is
    if (!url.startsWith('indexeddb://clipboard-images/')) {
      return of(url);
    }

    // Check cache first - if already resolving or resolved, return the cached observable
    const cached = this._cache.get(url);
    if (cached) {
      return cached;
    }

    // Use defer to ensure the promise is created fresh and properly handled
    const resolved$ = defer(() =>
      from(this._clipboardImageService.resolveIndexedDbUrl(url)),
    ).pipe(
      map((resolvedUrl) => {
        if (resolvedUrl) {
          return resolvedUrl;
        }
        return url;
      }),
      catchError((error) => {
        console.error('Error resolving clipboard URL:', error);
        return of(url);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    // Cache immediately before returning so concurrent calls will get the same observable
    this._cache.set(url, resolved$);
    return resolved$;
  }
}
