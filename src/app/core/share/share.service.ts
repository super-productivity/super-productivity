import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { IS_NATIVE_PLATFORM } from '../../util/is-native-platform';
import { SnackService } from '../snack/snack.service';
import {
  ShareCanvasImageParams,
  ShareCanvasTagline,
  SharePayload,
  ShareResult,
  ShareTarget,
  ShareTargetConfig,
} from './share.model';
import * as ShareTextUtil from './share-text.util';
import * as ShareUrlBuilder from './share-url-builder.util';
import * as ShareFileUtil from './share-file.util';
import * as SharePlatformUtil from './share-platform.util';

export type ShareOutcome = 'shared' | 'cancelled' | 'unavailable' | 'failed';
export type { ShareSupport } from './share-platform.util';

interface ShareParams {
  title?: string | null;
  text: string;
}

/**
 * Share service for multi-platform content sharing.
 * Supports Electron (Desktop), Capacitor (Android), and Web (PWA/Browser).
 * Provides a legacy shareText API that only triggers native/web share without UI fallbacks.
 */
@Injectable({
  providedIn: 'root',
})
export class ShareService {
  private _shareSupportPromise?: Promise<SharePlatformUtil.ShareSupport>;

  private _snackService = inject(SnackService);
  private _matDialog = inject(MatDialog);

  async shareText({ title, text }: ShareParams): Promise<ShareOutcome> {
    if (!text || typeof window === 'undefined') {
      return 'failed';
    }

    const result = await this.tryNativeShare({
      title: title ?? undefined,
      text,
    });

    if (result.success) {
      return 'shared';
    }

    if (result.error === 'Share cancelled') {
      return 'cancelled';
    }

    if (result.error === 'Native share not available') {
      return 'unavailable';
    }

    return 'failed';
  }

  canOpenDownloadResult(result: ShareResult): boolean {
    return ShareFileUtil.canOpenDownloadResult(result);
  }

  async openDownloadResult(result: ShareResult): Promise<void> {
    return ShareFileUtil.openDownloadResult(result);
  }

  async getShareSupport(): Promise<SharePlatformUtil.ShareSupport> {
    if (typeof window === 'undefined') {
      return 'none';
    }

    if (!this._shareSupportPromise) {
      this._shareSupportPromise = SharePlatformUtil.detectShareSupport();
    }

    return this._shareSupportPromise;
  }

  /**
   * Main share method - automatically detects platform and uses best method.
   */
  async share(payload: SharePayload, target?: ShareTarget): Promise<ShareResult> {
    const normalizedPayload = ShareTextUtil.ensureShareText(payload);

    if (!payload.text && !payload.url) {
      return {
        success: false,
        error: 'No content to share',
      };
    }

    if (target) {
      return this.shareToTarget(payload, target);
    }

    const nativeResult = await this.tryNativeShare(normalizedPayload);
    if (nativeResult.success) {
      return nativeResult;
    }

    return this._showShareDialog(normalizedPayload);
  }

  /**
   * Share to a specific target (public API for dialog component).
   */
  async shareToTarget(payload: SharePayload, target: ShareTarget): Promise<ShareResult> {
    const normalized = ShareTextUtil.ensureShareText(payload);

    try {
      switch (target) {
        case 'native':
          return this.tryNativeShare(normalized);
        case 'clipboard-text':
          return this.copyToClipboard(
            ShareTextUtil.formatTextForClipboard(payload),
            'Text',
          );
        default:
          return this._openShareUrl(normalized, target);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        target,
      };
    }
  }

  /**
   * Share a canvas element as an image, supporting native, web, and download fallbacks.
   */
  async shareCanvasImage(params: ShareCanvasImageParams): Promise<ShareResult> {
    if (typeof window === 'undefined' || !params?.canvas) {
      return {
        success: false,
        error: 'Canvas not available',
      };
    }

    const filename = ShareFileUtil.sanitizeFilename(
      params.filename ?? 'shared-image.png',
    );
    const shareTitle = params.shareTitle ?? filename;
    const canvasForExport = this._prepareCanvasForShare(params.canvas, params.tagline);
    const dataUrl = canvasForExport.toDataURL('image/png', 1.0);
    const base64 = ShareFileUtil.extractBase64(dataUrl);
    const blob = await this._canvasToBlob(canvasForExport);
    if (!blob) {
      return {
        success: false,
        error: 'Failed to export image',
      };
    }

    if (params.mode === 'download-only') {
      return this._saveCanvasDownload({
        blob,
        base64,
        filename,
        dataUrl,
      });
    }

    if (base64) {
      const nativeResult = await this._shareCanvasViaNative(base64, filename, shareTitle);
      if (nativeResult.success || nativeResult.error === 'Share cancelled') {
        return nativeResult;
      }
    }

    const webResult = await this._shareCanvasViaWeb(blob, filename, shareTitle, dataUrl);
    if (webResult.success || webResult.error === 'Share cancelled') {
      return webResult;
    }

    if (params.fallbackToDownload !== false) {
      return this._saveCanvasDownload({
        blob,
        base64,
        filename,
        dataUrl,
      });
    }

    return {
      success: false,
      error: 'Share not available',
    };
  }

  /**
   * Try to use native share (Android, Web Share API).
   * Public API for dialog component.
   */
  async tryNativeShare(payload: SharePayload): Promise<ShareResult> {
    const normalized = ShareTextUtil.ensureShareText(payload);

    const capacitorShare = SharePlatformUtil.getCapacitorSharePlugin();
    if (capacitorShare) {
      try {
        await capacitorShare.share({
          title: normalized.title,
          text: normalized.text,
          url: normalized.url,
          files: normalized.files,
          dialogTitle: 'Share via',
        });
        this._snackService.open('Shared successfully!');
        return {
          success: true,
          usedNative: true,
          target: 'native',
        };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return {
            success: false,
            error: 'Share cancelled',
          };
        }
        console.warn('Capacitor share failed:', error);
      }
    }

    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({
          title: normalized.title,
          text: normalized.text,
          url: normalized.url,
        });
        this._snackService.open('Shared successfully!');
        return {
          success: true,
          usedNative: true,
          target: 'native',
        };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return { success: false, error: 'Share cancelled' };
        }
        console.warn('Web Share API failed:', error);
      }
    }

    return {
      success: false,
      error: 'Native share not available',
    };
  }

  /**
   * Open share dialog with all available targets.
   */
  private async _showShareDialog(payload: SharePayload): Promise<ShareResult> {
    try {
      // Import dialog component dynamically to avoid circular dependencies
      const { DialogShareComponent } =
        await import('./dialog-share/dialog-share.component');

      const dialogRef = this._matDialog.open(DialogShareComponent, {
        width: '500px',
        data: {
          payload,
          showNative: await SharePlatformUtil.isSystemShareAvailable(),
        },
      });

      const result = await dialogRef.afterClosed().toPromise();

      if (result) {
        return result;
      }

      return {
        success: false,
        error: 'Share cancelled',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to open share dialog',
      };
    }
  }

  /**
   * Open a share URL in the default browser.
   */
  private async _openShareUrl(
    payload: SharePayload,
    target: ShareTarget,
  ): Promise<ShareResult> {
    const normalized = ShareTextUtil.ensureShareText(payload);
    const url = ShareUrlBuilder.buildShareUrl(normalized, target);

    window.open(url, '_blank', 'noopener,noreferrer');

    this._snackService.open('Opening share window...');

    return {
      success: true,
      target,
    };
  }

  /**
   * Copy text to clipboard (public API for dialog component).
   */
  async copyToClipboard(text: string, label: string): Promise<ShareResult> {
    try {
      await navigator.clipboard.writeText(text);
      this._snackService.open(`${label} copied to clipboard!`);
      return {
        success: true,
        target: 'clipboard-text',
      };
    } catch (error) {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);

        this._snackService.open(`${label} copied to clipboard!`);
        return {
          success: true,
          target: 'clipboard-text',
        };
      } catch (fallbackError) {
        return {
          success: false,
          error: 'Failed to copy to clipboard',
        };
      }
    }
  }

  /**
   * Format payload as plain text for clipboard (public API for dialog component).
   */
  formatTextForClipboard(payload: SharePayload): string {
    return ShareTextUtil.formatTextForClipboard(payload);
  }

  /**
   * Check if native/system share is available on current platform.
   */
  /**
   * Get available share targets with their configurations.
   */
  getShareTargets(): ShareTargetConfig[] {
    return [
      {
        label: 'Twitter',
        icon: 'link',
        available: true,
        color: '#1DA1F2',
      },
      {
        label: 'LinkedIn',
        icon: 'link',
        available: true,
        color: '#0A66C2',
      },
      {
        label: 'Reddit',
        icon: 'link',
        available: true,
        color: '#FF4500',
      },
      {
        label: 'Facebook',
        icon: 'link',
        available: true,
        color: '#1877F2',
      },
      {
        label: 'WhatsApp',
        icon: 'chat',
        available: true,
        color: '#25D366',
      },
      {
        label: 'Telegram',
        icon: 'send',
        available: true,
        color: '#0088CC',
      },
      {
        label: 'Email',
        icon: 'email',
        available: true,
      },
      {
        label: 'Mastodon',
        icon: 'link',
        available: true,
        color: '#6364FF',
      },
    ];
  }

  private _prepareCanvasForShare(
    canvas: HTMLCanvasElement,
    tagline?: ShareCanvasTagline,
  ): HTMLCanvasElement {
    if (!tagline?.text) {
      return canvas;
    }

    const taglineHeight = Math.max(1, tagline.height ?? 48);
    const newCanvas = document.createElement('canvas');
    newCanvas.width = canvas.width;
    newCanvas.height = canvas.height + taglineHeight;

    const ctx = newCanvas.getContext('2d');
    if (!ctx) {
      return canvas;
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, newCanvas.width, newCanvas.height);
    ctx.drawImage(canvas, 0, 0);

    ctx.fillStyle = tagline.color ?? 'rgba(0, 0, 0, 0.6)';
    const baseFontSize = Math.max(20, Math.round(newCanvas.width / 40));
    ctx.font = `${baseFontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const taglineOffset = taglineHeight / 2;
    const taglineY = canvas.height + taglineOffset;
    ctx.fillText(tagline.text, newCanvas.width / 2, taglineY);

    return newCanvas;
  }

  private _canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png', 1.0);
    });
  }

  private async _shareCanvasViaNative(
    base64: string,
    filename: string,
    title: string,
  ): Promise<ShareResult> {
    const sharePlugin = SharePlatformUtil.getCapacitorSharePlugin();
    if (!sharePlugin) {
      return {
        success: false,
        error: 'Native share not available',
      };
    }

    const sanitizedName = ShareFileUtil.sanitizeFilename(filename);
    const relativePath = `shared-images/${Date.now()}-${sanitizedName}`;
    let fileUrl: string | null = null;
    let resolvedUri: string | null = null;

    try {
      const writeResult = await Filesystem.writeFile({
        path: relativePath,
        data: base64,
        directory: Directory.Cache,
        recursive: true,
      });

      resolvedUri =
        writeResult.uri ??
        (
          await Filesystem.getUri({
            directory: Directory.Cache,
            path: relativePath,
          })
        ).uri;

      if (!resolvedUri) {
        throw new Error('Failed to resolve native share uri');
      }

      fileUrl = resolvedUri.startsWith('file://')
        ? resolvedUri
        : resolvedUri.startsWith('/')
          ? `file://${resolvedUri}`
          : `file:///${resolvedUri}`;

      console.debug('[ShareService] shareCanvasViaNative', {
        resolvedUri,
        fileUrl,
        relativePath,
      });

      try {
        const stat = await Filesystem.stat({
          path: relativePath,
          directory: Directory.Cache,
        });
        console.debug('[ShareService] shareCanvasViaNative stat', stat);
      } catch (statError) {
        console.warn('[ShareService] stat failed for shared image', statError);
      }

      const canShare = (await sharePlugin.canShare?.())?.value ?? true;
      if (!canShare) {
        return {
          success: false,
          error: 'Native share not available',
        };
      }

      await sharePlugin.share({
        title,
        text: '',
        files: [fileUrl],
        dialogTitle: 'Share via',
      });

      this._snackService.open('Shared successfully!');
      ShareFileUtil.scheduleCacheCleanup(relativePath);
      return {
        success: true,
        usedNative: true,
        target: 'native',
      };
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (err?.name === 'AbortError' || /Share canceled/i.test(err?.message ?? '')) {
        return {
          success: false,
          error: 'Share cancelled',
        };
      }
      console.warn('Native image share failed:', error, {
        fileUrl: fileUrl ?? 'n/a',
        resolvedUri: resolvedUri ?? 'n/a',
        relativePath,
      });
      ShareFileUtil.scheduleCacheCleanup(relativePath);
      return {
        success: false,
        error: 'Native share failed',
      };
    }
  }

  private async _shareCanvasViaWeb(
    blob: Blob,
    filename: string,
    title: string,
    dataUrl: string,
  ): Promise<ShareResult> {
    if (typeof navigator === 'undefined') {
      return {
        success: false,
        error: 'Share not available',
      };
    }

    try {
      if (typeof File !== 'undefined') {
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title,
          });
          this._snackService.open('Shared successfully!');
          return {
            success: true,
            usedNative: true,
            target: 'native',
          };
        }
      }

      if (typeof navigator.share === 'function') {
        await navigator.share({
          title,
          url: dataUrl,
        });
        this._snackService.open('Shared successfully!');
        return {
          success: true,
          usedNative: true,
          target: 'native',
        };
      }
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err?.name === 'AbortError') {
        return {
          success: false,
          error: 'Share cancelled',
        };
      }
      console.warn('Web Share API failed:', error);
    }

    return {
      success: false,
      error: 'Share not available',
    };
  }

  private async _saveCanvasDownload({
    blob,
    base64,
    filename,
    dataUrl,
  }: {
    blob: Blob;
    base64?: string | null;
    filename: string;
    dataUrl: string;
  }): Promise<ShareResult> {
    if (base64 && IS_NATIVE_PLATFORM) {
      const sanitizedName = ShareFileUtil.sanitizeFilename(filename);
      const relativePath = `shared-images/${Date.now()}-${sanitizedName}`;
      try {
        const writeResult = await Filesystem.writeFile({
          path: relativePath,
          data: base64,
          directory: Directory.Documents,
          recursive: true,
        });

        const uri =
          writeResult.uri ??
          (
            await Filesystem.getUri({
              directory: Directory.Documents,
              path: relativePath,
            })
          ).uri;

        const storedPath = `Documents/${relativePath}`;

        return {
          success: true,
          target: 'download',
          usedNative: true,
          path: storedPath,
          uri,
        };
      } catch (error) {
        console.warn('Native download failed, falling back to browser download:', error);
      }
    }

    const downloaded = ShareFileUtil.downloadBlob(blob, filename);
    if (downloaded) {
      return {
        success: true,
        target: 'download',
      };
    }

    if (typeof window !== 'undefined' && dataUrl) {
      try {
        window.open(dataUrl, '_blank');
        return {
          success: true,
          target: 'download',
        };
      } catch (error) {
        console.warn('Opening image in new tab failed:', error);
      }
    }

    return {
      success: false,
      error: 'Download failed',
    };
  }
}
