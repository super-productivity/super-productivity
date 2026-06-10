import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { LS } from '../../core/persistence/storage-keys.const';
import { CalendarIntegrationEvent } from './calendar-integration.model';
import { getCalendarEventIdCandidates } from './get-calendar-event-id-candidates';

@Injectable({
  providedIn: 'root',
})
export class HiddenCalendarEventsService {
  private static readonly _MAX_HIDDEN_EVENT_IDS = 500;

  readonly hiddenEventIds$ = new BehaviorSubject<string[]>(this._loadFromStorage());

  hideEvent(calEv: CalendarIntegrationEvent): void {
    const idsToAdd = getCalendarEventIdCandidates(calEv).filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (!idsToAdd.length) {
      return;
    }
    const current = this.hiddenEventIds$.getValue();
    let updated = [...current, ...idsToAdd.filter((id) => !current.includes(id))];
    if (updated.length > HiddenCalendarEventsService._MAX_HIDDEN_EVENT_IDS) {
      updated = updated.slice(
        updated.length - HiddenCalendarEventsService._MAX_HIDDEN_EVENT_IDS,
      );
    }
    this.hiddenEventIds$.next(updated);
    this._saveToStorage(updated);
  }

  private _loadFromStorage(): string[] {
    try {
      const stored = localStorage.getItem(LS.HIDDEN_CALENDAR_EVENT_IDS);
      if (stored) {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // ignore parse errors
    }
    return [];
  }

  private _saveToStorage(ids: string[]): void {
    localStorage.setItem(LS.HIDDEN_CALENDAR_EVENT_IDS, JSON.stringify(ids));
  }
}
