import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class MaterialIconsLoaderService {
  private icons: string[] | null = null;
  private loadingPromise: Promise<string[]> | null = null;

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

  private async _loadModule(): Promise<string[]> {
    const { MATERIAL_ICONS } = await import('./material-icons.const');
    this.icons = MATERIAL_ICONS;
    return MATERIAL_ICONS;
  }
}
