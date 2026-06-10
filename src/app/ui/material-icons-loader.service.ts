import { Injectable } from '@angular/core';
import { BodyClass } from '../app.constants';

const MATERIAL_ICONS_FONT = '24px "Material Symbols Outlined"';
const MATERIAL_ICONS_FONT_READY_TIMEOUT_MS = 3000;

@Injectable({
  providedIn: 'root',
})
export class MaterialIconsLoaderService {
  private icons: string[] | null = null;
  private loadingPromise: Promise<string[]> | null = null;
  private fontReadyPromise: Promise<void> | null = null;

  async loadIcons(): Promise<string[]> {
    // Return cached icons if already loaded
    if (this.icons) {
      return this.icons;
    }

    // Return existing promise if currently loading (prevents race conditions)
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    // Start loading and cache promise
    this.loadingPromise = this._loadModule();
    return this.loadingPromise;
  }

  ensureFontReady(): Promise<void> {
    if (typeof document === 'undefined') {
      return Promise.resolve();
    }

    const body = document.body;
    if (!body) {
      return Promise.resolve();
    }

    if (body.classList.contains(BodyClass.isMaterialSymbolsLoaded)) {
      return Promise.resolve();
    }

    const fonts = document.fonts;
    if (!fonts?.load) {
      body.classList.add(BodyClass.isMaterialSymbolsLoaded);
      return Promise.resolve();
    }

    if (this.fontReadyPromise) {
      return this.fontReadyPromise;
    }

    this.fontReadyPromise = this._loadFont(body, fonts);
    return this.fontReadyPromise;
  }

  private async _loadModule(): Promise<string[]> {
    const { MATERIAL_ICONS } = await import('./material-icons.const');
    this.icons = MATERIAL_ICONS;
    return MATERIAL_ICONS;
  }

  private async _loadFont(body: HTMLElement, fonts: FontFaceSet): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        fonts.load(MATERIAL_ICONS_FONT),
        new Promise<void>((resolve) => {
          timeoutId = setTimeout(resolve, MATERIAL_ICONS_FONT_READY_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Keep the UI usable if the browser fails the font readiness probe.
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      body.classList.add(BodyClass.isMaterialSymbolsLoaded);
    }
  }
}
