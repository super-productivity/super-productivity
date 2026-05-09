import { Injectable, signal } from '@angular/core';
import { loadFromRealLs, saveToRealLs } from '../../core/persistence/local-storage';
import { LS } from '../../core/persistence/storage-keys.const';

@Injectable({
  providedIn: 'root',
})
export class HiddenCalendarProvidersService {
  readonly hiddenProviderIds = signal<string[]>(this._loadFromStorage());

  toggle(providerId: string): void {
    this.hiddenProviderIds.update((current) =>
      current.includes(providerId)
        ? current.filter((id) => id !== providerId)
        : [...current, providerId],
    );
    saveToRealLs(LS.HIDDEN_CALENDAR_PROVIDER_IDS, this.hiddenProviderIds());
  }

  setHidden(ids: string[]): void {
    this.hiddenProviderIds.set(ids);
    saveToRealLs(LS.HIDDEN_CALENDAR_PROVIDER_IDS, ids);
  }

  private _loadFromStorage(): string[] {
    try {
      const stored = loadFromRealLs(LS.HIDDEN_CALENDAR_PROVIDER_IDS);
      return Array.isArray(stored) ? (stored as string[]) : [];
    } catch {
      return [];
    }
  }
}
