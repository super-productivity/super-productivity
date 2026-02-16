import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout, catchError, of } from 'rxjs';
import { IS_ELECTRON } from '../app.constants';

/**
 * Service to fetch URL metadata (page titles) for link attachments.
 * Includes caching to avoid redundant requests.
 * Uses Electron main process for fetching when available (avoids CORS issues).
 */
@Injectable({
  providedIn: 'root',
})
export class UrlMetadataService {
  private _http = inject(HttpClient);
  private _cache = new Map<string, string>();
  private _pendingRequests = new Map<string, Promise<string>>();
  private _isElectron = IS_ELECTRON;
  private readonly _maxCacheSize = 100;

  /**
   * Fetches the page title for a given URL.
   * Returns the title on success, or the URL basename on failure.
   *
   * @param url The URL to fetch metadata for
   * @param fallbackTitle Fallback title if fetch fails (defaults to URL basename)
   * @returns Promise<string> The page title or fallback
   */
  async fetchTitle(url: string, fallbackTitle: string): Promise<string> {
    // Skip for file:// URLs (can't fetch)
    if (url.startsWith('file://')) {
      return fallbackTitle;
    }

    // Check cache first
    if (this._cache.has(url)) {
      return this._cache.get(url)!;
    }

    // Check if there's already a pending request for this URL
    if (this._pendingRequests.has(url)) {
      return this._pendingRequests.get(url)!;
    }

    // Create and store pending request promise
    const fetchPromise = (async () => {
      try {
        let title: string | null = null;

        // Use Electron main process if available (avoids CORS)
        if (this._isElectron && (window as any).ea?.fetchUrlMetadata) {
          const result = await (window as any).ea.fetchUrlMetadata(url);
          // Electron returns raw HTML, extract title from it
          title = result.html ? this._extractTitle(result.html) : null;
        } else {
          // Fallback to browser fetch (subject to CORS)
          const html = await firstValueFrom(
            this._http.get(url, { responseType: 'text' }).pipe(
              timeout(5000),
              catchError((error: HttpErrorResponse) => {
                // CORS or network error - return null
                return of(null);
              }),
            ),
          );

          if (html) {
            title = this._extractTitle(html);
          }
        }

        const finalTitle = title || fallbackTitle;

        // Cache result with eviction policy
        this._addToCache(url, finalTitle);
        return finalTitle;
      } catch (_error) {
        // Timeout or other error - use fallback
        this._addToCache(url, fallbackTitle);
        return fallbackTitle;
      } finally {
        // Clean up pending request
        this._pendingRequests.delete(url);
      }
    })();

    // Store the promise so other callers can wait for it
    this._pendingRequests.set(url, fetchPromise);
    return fetchPromise;
  }

  /**
   * Extracts the page title from HTML content.
   * Tries <title> tag first, then OpenGraph og:title.
   * Decodes HTML entities in the extracted title.
   */
  private _extractTitle(html: string): string | null {
    // Try <title> tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      return this._decodeHtmlEntities(titleMatch[1].trim());
    }

    // Try OpenGraph og:title
    const ogTitleMatch = html.match(
      /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
    );
    if (ogTitleMatch && ogTitleMatch[1]) {
      return this._decodeHtmlEntities(ogTitleMatch[1].trim());
    }

    // Try OpenGraph og:title (reversed attribute order)
    const ogTitleMatch2 = html.match(
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i,
    );
    if (ogTitleMatch2 && ogTitleMatch2[1]) {
      return this._decodeHtmlEntities(ogTitleMatch2[1].trim());
    }

    return null;
  }

  /**
   * Decodes HTML entities in text using browser's native DOM API.
   * This handles all named entities and numeric entities (&#NNN; &#xHHH;) correctly.
   *
   * Note: This method is used for both Electron and browser modes. Electron returns
   * raw HTML which is then extracted and decoded here, eliminating code duplication.
   */
  private _decodeHtmlEntities(text: string): string {
    // Use browser's built-in HTML entity decoder via DOM API
    // This is much more reliable than rolling our own parser
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  }

  /**
   * Adds entry to cache with LRU eviction policy.
   * When cache exceeds max size, removes oldest entries.
   */
  private _addToCache(url: string, title: string): void {
    // If cache is at capacity, remove oldest entry (first entry in Map)
    if (this._cache.size >= this._maxCacheSize) {
      const firstKey = this._cache.keys().next().value;
      if (firstKey) {
        this._cache.delete(firstKey);
      }
    }
    this._cache.set(url, title);
  }

  /**
   * Clears the metadata cache
   */
  clearCache(): void {
    this._cache.clear();
  }
}
