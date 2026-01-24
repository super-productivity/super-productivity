import { Injectable, inject } from '@angular/core';
import { IS_ELECTRON } from '../../app.constants';
import { SnackService } from '../snack/snack.service';
import { T } from '../../t.const';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { getDefaultClipboardImagesPath } from '../../util/get-default-clipboard-images-path';
import { MIME_TYPE_EXTENSIONS } from '../../../../electron/shared-with-frontend/mime-type-mapping.const';

const DB_NAME = 'sp-clipboard-images';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
const INDEXEDDB_PROTOCOL = 'indexeddb://clipboard-images/';

export interface ClipboardImageEntry {
  id: string;
  blob: Blob;
  mimeType: string;
  createdAt: number;
  size: number;
}

export interface ClipboardImageMetadata {
  id: string;
  mimeType: string;
  createdAt: number;
  size: number;
}

export interface ClipboardImagePasteResult {
  success: boolean;
  imageUrl?: string;
  markdownText?: string;
  errorMessage?: string;
}

export interface ClipboardImagePasteProgress {
  placeholderText: string;
  resultPromise: Promise<ClipboardImagePasteResult>;
}

/**
 * Unified service for clipboard image operations.
 * Handles storage (IndexedDB/Electron), URL resolution, and paste events.
 */
@Injectable({
  providedIn: 'root',
})
export class ClipboardImageService {
  private _snackService = inject(SnackService);
  private _globalConfigService = inject(GlobalConfigService);
  private _db: IDBDatabase | null = null;
  private _dbPromise: Promise<IDBDatabase> | null = null;
  private _blobUrlCache = new Map<string, string>();

  // ===========================================================================
  // Paste handling
  // ===========================================================================

  /**
   * Handles paste with loading placeholder. Returns immediately with placeholder,
   * and provides a promise for the final result.
   */
  handlePasteWithProgress(event: ClipboardEvent): ClipboardImagePasteProgress | null {
    const clipboardData = event.clipboardData;
    if (!clipboardData || !this._hasImageInClipboard(clipboardData)) {
      return null;
    }

    const placeholderText = '![Saving image...]()';
    const resultPromise = this._saveImageFromClipboard(clipboardData);

    return { placeholderText, resultPromise };
  }

  private _hasImageInClipboard(clipboardData: DataTransfer): boolean {
    for (let i = 0; i < clipboardData.items.length; i++) {
      if (clipboardData.items[i].type.startsWith('image/')) {
        return true;
      }
    }
    for (let i = 0; i < clipboardData.files.length; i++) {
      if (clipboardData.files[i].type.startsWith('image/')) {
        return true;
      }
    }
    return false;
  }

  private async _saveImageFromClipboard(
    clipboardData: DataTransfer,
  ): Promise<ClipboardImagePasteResult> {
    // In Electron, first check if clipboard contains file paths
    if (IS_ELECTRON) {
      // Check for files in clipboard using clipboardData.files
      if (clipboardData.files && clipboardData.files.length > 0) {
        // Try to get file paths using webUtils.getPathForFile
        for (let i = 0; i < clipboardData.files.length; i++) {
          const file = clipboardData.files[i];

          if (file.type.startsWith('image/')) {
            try {
              const filePath = window.ea.getPathForFile(file);

              if (filePath) {
                // Don't copy the file, just use the original path directly
                const imageUrl = `file://${filePath.replace(/\\/g, '/')}`;
                const fileName = file.name || 'image';
                const fileNameWithoutExt = fileName.replace(/\.[^.]+$/, '');
                const markdownText = `![${fileNameWithoutExt}](${imageUrl})`;

                this._snackService.open({
                  type: 'SUCCESS',
                  msg: T.F.CLIPBOARD_IMAGE.PASTE_SUCCESS,
                });

                return { success: true, imageUrl, markdownText };
              }
            } catch (error) {
              console.error('[CLIPBOARD] Error getting file path:', error);
            }
          }
        }
      }

      // Try reading image directly from clipboard using Electron API
      const basePath = await this._getElectronImagePath();
      const result = await window.ea.readClipboardImage(basePath);

      if (result) {
        // Get the saved file path and generate file:// URL
        const savedFilePath = await window.ea.getClipboardImagePath(basePath, result.id);
        if (savedFilePath) {
          const imageUrl = `file://${savedFilePath.replace(/\\/g, '/')}`;
          const markdownText = `![pasted image](${imageUrl})`;

          this._snackService.open({
            type: 'SUCCESS',
            msg: T.F.CLIPBOARD_IMAGE.PASTE_SUCCESS,
          });

          return { success: true, imageUrl, markdownText };
        }
      }
    }

    // Fall back to extracting image from clipboard data
    const imageBlob = await this._extractImageFromClipboard(clipboardData);
    if (!imageBlob) {
      return { success: false };
    }

    try {
      const imageUrl = await this.saveImage(imageBlob);
      if (!imageUrl) {
        return { success: false, errorMessage: 'Failed to save image' };
      }

      const markdownText = `![pasted image](${imageUrl})`;
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.CLIPBOARD_IMAGE.PASTE_SUCCESS,
      });

      return { success: true, imageUrl, markdownText };
    } catch (error) {
      console.error('[CLIPBOARD] Error saving clipboard image:', error);
      console.error(
        '[CLIPBOARD] Error stack:',
        error instanceof Error ? error.stack : 'no stack',
      );
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async _tryGetImageFromFilePaths(): Promise<ClipboardImagePasteResult | null> {
    try {
      const filePaths = await window.ea.getClipboardFilePaths();
      if (!filePaths || filePaths.length === 0) {
        // Try reading image directly from clipboard
        const basePath = await this._getElectronImagePath();
        const result = await window.ea.readClipboardImage(basePath);

        if (result) {
          // Get the saved file path and generate file:// URL
          const savedFilePath = await window.ea.getClipboardImagePath(
            basePath,
            result.id,
          );
          if (savedFilePath) {
            const imageUrl = `file://${savedFilePath.replace(/\\/g, '/')}`;
            const markdownText = `![pasted image](${imageUrl})`;

            this._snackService.open({
              type: 'SUCCESS',
              msg: T.F.CLIPBOARD_IMAGE.PASTE_SUCCESS,
            });

            return { success: true, imageUrl, markdownText };
          }
        }

        return null;
      }

      // Use the first image file found
      const filePath = filePaths[0];
      const basePath = await this._getElectronImagePath();

      // Copy the file to clipboard-images directory
      const result = await window.ea.copyClipboardImageFile(basePath, filePath);
      if (!result) {
        return null;
      }

      // Get the saved file path and generate file:// URL
      const savedFilePath = await window.ea.getClipboardImagePath(basePath, result.id);
      if (!savedFilePath) {
        return null;
      }

      const imageUrl = `file://${savedFilePath.replace(/\\/g, '/')}`;
      const fileName = filePath.split(/[\\/]/).pop() || 'image';
      const fileNameWithoutExt = fileName.replace(/\.[^.]+$/, '');
      const markdownText = `![${fileNameWithoutExt}](${imageUrl})`;

      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.CLIPBOARD_IMAGE.PASTE_SUCCESS,
      });

      return { success: true, imageUrl, markdownText };
    } catch (error) {
      console.error('Error getting image from file paths:', error);
      return null; // Fall back to regular clipboard handling
    }
  }

  private async _extractImageFromClipboard(
    clipboardData: DataTransfer,
  ): Promise<Blob | null> {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) return blob;
      }
    }
    for (let i = 0; i < clipboardData.files.length; i++) {
      const file = clipboardData.files[i];
      if (file.type.startsWith('image/')) {
        return file;
      }
    }
    return null;
  }

  // ===========================================================================
  // URL resolution
  // ===========================================================================

  isIndexedDbUrl(url: string): boolean {
    return url.startsWith(INDEXEDDB_PROTOCOL);
  }

  extractImageId(url: string): string | null {
    const match = url.match(/^indexeddb:\/\/clipboard-images\/([^?\s=]+)/);
    return match ? match[1] : null;
  }

  /**
   * Pre-resolves all indexeddb:// URLs in markdown content to blob/file URLs.
   * Call this before rendering markdown to ensure images display correctly.
   */
  async resolveMarkdownImages(markdown: string): Promise<string> {
    const urlPattern = /indexeddb:\/\/clipboard-images\/[^)\s=]+/g;
    const matches = markdown.match(urlPattern);
    if (!matches) return markdown;

    const uniqueUrls = [...new Set(matches)];
    const resolved = new Map<string, string>();

    await Promise.all(
      uniqueUrls.map(async (url) => {
        const blobUrl = await this.resolveIndexedDbUrl(url);
        if (blobUrl) {
          resolved.set(url, blobUrl);
        }
      }),
    );

    let result = markdown;
    for (const [original, replacement] of resolved) {
      result = result.split(original).join(replacement);
    }
    return result;
  }

  async resolveIndexedDbUrl(indexedDbUrl: string): Promise<string | null> {
    if (!this.isIndexedDbUrl(indexedDbUrl)) return null;

    const imageId = this.extractImageId(indexedDbUrl);
    if (!imageId) return null;

    const cached = this._blobUrlCache.get(imageId);
    if (cached) return cached;

    try {
      const blob = await this.getImage(imageId);
      if (!blob) return null;

      const blobUrl = URL.createObjectURL(blob);
      this._blobUrlCache.set(imageId, blobUrl);
      return blobUrl;
    } catch (error) {
      console.error('Error resolving indexeddb URL for clipboard image:', error);
      return null;
    }
  }

  // ===========================================================================
  // Storage operations
  // ===========================================================================

  async saveImage(blob: Blob, preferredId?: string): Promise<string | null> {
    // Only enforce size limit in web environment (IndexedDB has limitations)
    if (!IS_ELECTRON && blob.size > MAX_IMAGE_SIZE_BYTES) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.CLIPBOARD_IMAGE.SIZE_EXCEEDED,
        translateParams: {
          maxSize: this._formatSize(MAX_IMAGE_SIZE_BYTES),
          actualSize: this._formatSize(blob.size),
        },
      });
      return null;
    }

    const id = preferredId || this._generateImageId();
    const mimeType = blob.type || 'image/png';

    return IS_ELECTRON
      ? this._saveImageElectron(id, blob, mimeType)
      : this._saveImageWeb(id, blob, mimeType);
  }

  async getImage(id: string): Promise<Blob | null> {
    return IS_ELECTRON ? this._getImageElectron(id) : this._getImageWeb(id);
  }

  async deleteImage(id: string): Promise<boolean> {
    return IS_ELECTRON ? this._deleteImageElectron(id) : this._deleteImageWeb(id);
  }

  async listImages(): Promise<ClipboardImageMetadata[]> {
    return IS_ELECTRON ? this._listImagesElectron() : this._listImagesWeb();
  }

  getImageUrl(id: string): string {
    return `${INDEXEDDB_PROTOCOL}${id}`;
  }

  private _generateImageId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `clip-${timestamp}-${random}`;
  }

  // ===========================================================================
  // Web (IndexedDB) implementation
  // ===========================================================================

  private async _getDb(): Promise<IDBDatabase> {
    if (this._db) return this._db;
    if (this._dbPromise) return this._dbPromise;

    this._dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (): void => {
        reject(new Error('Failed to open clipboard images database'));
      };

      request.onsuccess = (): void => {
        this._db = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = (event): void => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });

    return this._dbPromise;
  }

  private async _saveImageWeb(id: string, blob: Blob, mimeType: string): Promise<string> {
    const db = await this._getDb();
    const entry: ClipboardImageEntry = {
      id,
      blob,
      mimeType,
      createdAt: Date.now(),
      size: blob.size,
    };

    return new Promise<string>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(entry);

      request.onsuccess = (): void => resolve(this.getImageUrl(id));
      request.onerror = (): void => {
        const error = request.error;
        if (error?.name === 'QuotaExceededError') {
          this._snackService.open({
            type: 'ERROR',
            msg: T.F.CLIPBOARD_IMAGE.STORAGE_QUOTA_EXCEEDED,
          });
          reject(new Error('Storage quota exceeded'));
        } else {
          reject(new Error('Failed to save clipboard image'));
        }
      };
    });
  }

  private async _getImageWeb(id: string): Promise<Blob | null> {
    const db = await this._getDb();

    return new Promise<Blob | null>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = (): void => {
        const entry = request.result as ClipboardImageEntry | undefined;
        resolve(entry?.blob ?? null);
      };
      request.onerror = (): void => reject(new Error('Failed to get clipboard image'));
    });
  }

  private async _deleteImageWeb(id: string): Promise<boolean> {
    // Revoke cached blob URL to prevent memory leak
    const cachedUrl = this._blobUrlCache.get(id);
    if (cachedUrl) {
      URL.revokeObjectURL(cachedUrl);
      this._blobUrlCache.delete(id);
    }

    const db = await this._getDb();

    return new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = (): void => resolve(true);
      request.onerror = (): void => reject(new Error('Failed to delete clipboard image'));
    });
  }

  private async _listImagesWeb(): Promise<ClipboardImageMetadata[]> {
    const db = await this._getDb();

    return new Promise<ClipboardImageMetadata[]>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = (): void => {
        const entries = request.result as ClipboardImageEntry[];
        resolve(
          entries.map((entry) => ({
            id: entry.id,
            mimeType: entry.mimeType,
            createdAt: entry.createdAt,
            size: entry.size,
          })),
        );
      };
      request.onerror = (): void => reject(new Error('Failed to list clipboard images'));
    });
  }

  // ===========================================================================
  // Electron (Filesystem) implementation
  // ===========================================================================

  private async _getElectronImagePath(): Promise<string> {
    // Always fetch from config to respect user changes
    const customPath = this._globalConfigService.clipboardImages()?.imagePath;
    if (customPath) {
      return customPath;
    }

    // Use default path
    return getDefaultClipboardImagesPath();
  }

  private async _saveImageElectron(
    id: string,
    blob: Blob,
    mimeType: string,
  ): Promise<string> {
    const basePath = await this._getElectronImagePath();
    const ext = this._getExtensionFromMimeType(mimeType);
    const fileName = `${id}${ext}`;

    const arrayBuffer = await blob.arrayBuffer();
    const base64 = this._arrayBufferToBase64(arrayBuffer);

    const savedPath = await window.ea.saveClipboardImage(
      basePath,
      fileName,
      base64,
      mimeType,
    );

    // Return file:// URL directly for Electron
    const fileUrl = `file://${savedPath.replace(/\\/g, '/')}`;
    return fileUrl;
  }

  private async _getImageElectron(id: string): Promise<Blob | null> {
    const basePath = await this._getElectronImagePath();
    const result = await window.ea.loadClipboardImage(basePath, id);
    if (!result) return null;

    const binary = atob(result.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: result.mimeType });
  }

  private async _deleteImageElectron(id: string): Promise<boolean> {
    // Clean up cache entry (file:// URLs don't need revocation)
    this._blobUrlCache.delete(id);

    const basePath = await this._getElectronImagePath();
    return window.ea.deleteClipboardImage(basePath, id);
  }

  private async _listImagesElectron(): Promise<ClipboardImageMetadata[]> {
    const basePath = await this._getElectronImagePath();
    return window.ea.listClipboardImages(basePath);
  }

  // ===========================================================================
  // Utility methods
  // ===========================================================================

  private _formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private _getExtensionFromMimeType(mimeType: string): string {
    return MIME_TYPE_EXTENSIONS[mimeType as keyof typeof MIME_TYPE_EXTENSIONS] || '.png';
  }

  private _arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
