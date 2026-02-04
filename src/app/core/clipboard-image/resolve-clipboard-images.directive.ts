import {
  Directive,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  Input,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { ClipboardImageService } from './clipboard-image.service';

/**
 * Directive that resolves indexeddb:// URLs in img elements within the host element.
 * Apply this directive to elements containing markdown-rendered content.
 */
@Directive({
  selector: '[spResolveClipboardImages]',
  standalone: true,
})
export class ResolveClipboardImagesDirective implements OnInit, OnDestroy, OnChanges {
  private _elementRef = inject(ElementRef);
  private _clipboardImageService = inject(ClipboardImageService);
  private _observer: MutationObserver | null = null;
  private _resolvedImageIds = new Set<string>();
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _isResolving = false;

  @Input() spResolveClipboardImages: string | undefined;

  ngOnInit(): void {
    this._setupMutationObserver();
    // Initial resolve with delay to allow markdown to render
    setTimeout(() => this._resolveImages(), 100);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['spResolveClipboardImages']) {
      this._resolvedImageIds.clear();
      // Delay to allow markdown to re-render
      setTimeout(() => this._resolveImages(), 100);
    }
  }

  ngOnDestroy(): void {
    this._observer?.disconnect();
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
  }

  private _setupMutationObserver(): void {
    this._observer = new MutationObserver(() => this._resolveImagesDebounced());
    this._observer.observe(this._elementRef.nativeElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'class'],
    });
  }

  private _resolveImagesDebounced(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => this._resolveImages(), 50);
  }

  private async _resolveImages(): Promise<void> {
    if (this._isResolving) return;
    this._isResolving = true;

    try {
      const element = this._elementRef.nativeElement as HTMLElement;
      // Find images with either the indexeddb-image class OR indexeddb:// URLs in src
      const images = element.querySelectorAll<HTMLImageElement>(
        'img.indexeddb-image, img[src^="indexeddb://"]',
      );

      for (const img of Array.from(images)) {
        // Read the indexeddb:// URL directly from src attribute
        const indexedDbUrl = img.getAttribute('src');
        if (!indexedDbUrl || !indexedDbUrl.startsWith('indexeddb://')) continue;

        const imageId = this._clipboardImageService.extractImageId(indexedDbUrl);
        if (!imageId || this._resolvedImageIds.has(imageId)) continue;

        try {
          const resolvedUrl =
            await this._clipboardImageService.resolveIndexedDbUrl(indexedDbUrl);
          if (resolvedUrl) {
            img.src = resolvedUrl;
            img.classList.remove('indexeddb-image');
            img.classList.add('indexeddb-image-resolved');
            this._resolvedImageIds.add(imageId);
          } else {
            img.alt = 'Image not found';
            img.classList.add('indexeddb-image-error');
          }
        } catch (error) {
          console.error('Error resolving clipboard image:', error);
          img.alt = 'Error loading image';
          img.classList.add('indexeddb-image-error');
        }
      }
    } finally {
      this._isResolving = false;
    }
  }
}
