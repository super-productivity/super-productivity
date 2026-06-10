import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { getEnvOptional } from '../../util/env';
import { Log } from '../log';

export interface UnsplashPhoto {
  id: string;
  urls: {
    raw: string;
    full: string;
    regular: string;
    small: string;
    thumb: string;
  };
  links?: {
    self?: string;
    html?: string;
    download?: string;
    download_location?: string;
  };
  description: string | null;
  alt_description: string | null;
  user: {
    name: string;
    links?: {
      html?: string;
    };
  };
}

export interface UnsplashSearchResponse {
  results: UnsplashPhoto[];
  total: number;
  total_pages: number;
}

@Injectable({
  providedIn: 'root',
})
export class UnsplashService {
  private _http = inject(HttpClient);

  private readonly API_URL = 'https://api.unsplash.com';
  // Register your app at https://unsplash.com/developers?utm_source=super-productivity&utm_medium=referral&utm_campaign=api-credit for a free Access Key (50 req/hour)
  // The Access Key is used with "Client-ID" prefix in the Authorization header
  private readonly ACCESS_KEY = getEnvOptional('UNSPLASH_KEY');

  isAvailable(): boolean {
    return !!this.ACCESS_KEY;
  }

  searchPhotos(query: string, page = 1): Observable<UnsplashSearchResponse> {
    if (!query || query.trim() === '') {
      return of({ results: [], total: 0, total_pages: 0 });
    }

    if (!this.ACCESS_KEY) {
      Log.warn(
        'No Unsplash Access Key configured. Register at https://unsplash.com/developers?utm_source=super-productivity&utm_medium=referral&utm_campaign=api-credit',
      );
      return of({ results: [], total: 0, total_pages: 0 });
    }

    const params = {
      query: query.trim(),
      page: page.toString(),
      per_page: '20',
      orientation: 'landscape',
    };

    const url = `${this.API_URL}/search/photos`;
    const headers = {
      Authorization: `Client-ID ${this.ACCESS_KEY}`,
    };

    return this._http
      .get<UnsplashSearchResponse>(url, {
        params,
        headers,
      })
      .pipe(
        catchError((error) => {
          Log.err('Unsplash API error:', error);
          return of({ results: [], total: 0, total_pages: 0 });
        }),
      );
  }

  getPhotoUrl(
    photo: UnsplashPhoto,
    size: 'thumb' | 'small' | 'regular' = 'regular',
  ): string {
    return photo.urls[size];
  }

  /**
   * Get optimized image URL for backgrounds
   * @param photo - The Unsplash photo object
   * @param width - Desired width (default 2560 for high res displays)
   * @param quality - Image quality 1-100 (default 85)
   */
  getBackgroundImageUrl(photo: UnsplashPhoto, width = 2560, quality = 85): string {
    return `${photo.urls.raw}&w=${width}&q=${quality}&auto=format`;
  }

  /**
   * Add UTM parameters to Unsplash attribution links as required
   * @param url - The original Unsplash URL
   */
  addUtmParams(url: string): string {
    if (!url) return url;

    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}utm_source=super-productivity&utm_medium=referral&utm_campaign=api-credit`;
  }

  /**
   * Trigger download tracking as required by Unsplash API guidelines
   * This must be called when a user selects a photo for use
   * @param photo - The selected photo
   */
  trackPhotoDownload(photo: UnsplashPhoto): Observable<any> {
    if (!photo.links?.download_location) {
      Log.warn('No download_location available for photo', photo.id);
      return of(null);
    }

    if (!this.ACCESS_KEY) {
      Log.warn('No Unsplash Access Key configured');
      return of(null);
    }

    const headers = {
      Authorization: `Client-ID ${this.ACCESS_KEY}`,
    };

    // Call the download endpoint to track usage
    return this._http.get(photo.links.download_location, { headers }).pipe(
      catchError((error) => {
        Log.err('Failed to track photo download:', error);
        // Don't fail the selection if tracking fails
        return of(null);
      }),
    );
  }
}
