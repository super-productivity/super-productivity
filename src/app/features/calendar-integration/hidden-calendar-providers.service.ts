import { Injectable, signal } from '@angular/core';
import { LS } from '../../core/persistence/storage-keys.const';

@Injectable({
  providedIn: 'root',
})
export class HiddenCalendarProvidersService {
  readonly hiddenProviderIds = signal<string[]>(this._loadFromStorage());

  toggle(providerId: string): void {
    const current = this.hiddenProviderIds();
    const next = current.includes(providerId)
      ? current.filter((id) => id !== providerId)
      : [...current, providerId];
    this.hiddenProviderIds.set(next);
    localStorage.setItem(LS.HIDDEN_CALENDAR_PROVIDER_IDS, JSON.stringify(next));
  }

  private _loadFromStorage(): string[] {
    try {
      const stored = localStorage.getItem(LS.HIDDEN_CALENDAR_PROVIDER_IDS);
      if (stored) {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // ignore parse errors
    }
    return [];
  }
}
