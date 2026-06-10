import { TestBed } from '@angular/core/testing';
import { HiddenCalendarProvidersService } from './hidden-calendar-providers.service';
import { LS } from '../../core/persistence/storage-keys.const';

describe('HiddenCalendarProvidersService', () => {
  let service: HiddenCalendarProvidersService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [HiddenCalendarProvidersService] });
    service = TestBed.inject(HiddenCalendarProvidersService);
  });

  afterEach(() => localStorage.clear());

  describe('toggle()', () => {
    it('should add a provider ID that is not currently hidden', () => {
      service.toggle('provider-A');
      expect(service.hiddenProviderIds()).toContain('provider-A');
    });

    it('should remove a provider ID that is already hidden', () => {
      service.toggle('provider-A');
      service.toggle('provider-A');
      expect(service.hiddenProviderIds()).not.toContain('provider-A');
    });

    it('should leave other IDs untouched when removing one', () => {
      service.toggle('provider-A');
      service.toggle('provider-B');
      service.toggle('provider-A');
      expect(service.hiddenProviderIds()).not.toContain('provider-A');
      expect(service.hiddenProviderIds()).toContain('provider-B');
    });

    it('should persist the updated list to localStorage', () => {
      service.toggle('provider-A');
      const stored = JSON.parse(localStorage.getItem(LS.HIDDEN_CALENDAR_PROVIDER_IDS)!);
      expect(stored).toContain('provider-A');
    });

    it('should remove the ID from localStorage when toggled off', () => {
      service.toggle('provider-A');
      service.toggle('provider-A');
      const stored = JSON.parse(localStorage.getItem(LS.HIDDEN_CALENDAR_PROVIDER_IDS)!);
      expect(stored).not.toContain('provider-A');
    });
  });

  describe('setHidden()', () => {
    it('should replace the entire hidden list', () => {
      service.toggle('provider-A');
      service.setHidden(['provider-B', 'provider-C']);
      expect(service.hiddenProviderIds()).toEqual(['provider-B', 'provider-C']);
    });

    it('should clear the list when called with an empty array', () => {
      service.toggle('provider-A');
      service.setHidden([]);
      expect(service.hiddenProviderIds()).toEqual([]);
    });

    it('should persist the new list to localStorage', () => {
      service.setHidden(['provider-X']);
      const stored = JSON.parse(localStorage.getItem(LS.HIDDEN_CALENDAR_PROVIDER_IDS)!);
      expect(stored).toEqual(['provider-X']);
    });
  });

  describe('initialization', () => {
    it('should start with an empty list when localStorage has nothing', () => {
      expect(service.hiddenProviderIds()).toEqual([]);
    });

    it('should load previously persisted IDs from localStorage', () => {
      localStorage.setItem(
        LS.HIDDEN_CALENDAR_PROVIDER_IDS,
        JSON.stringify(['provider-X', 'provider-Y']),
      );
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [HiddenCalendarProvidersService] });
      const fresh = TestBed.inject(HiddenCalendarProvidersService);
      expect(fresh.hiddenProviderIds()).toContain('provider-X');
      expect(fresh.hiddenProviderIds()).toContain('provider-Y');
    });

    it('should handle corrupt localStorage data gracefully', () => {
      localStorage.setItem(LS.HIDDEN_CALENDAR_PROVIDER_IDS, '{not valid json{{');
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [HiddenCalendarProvidersService] });
      const fresh = TestBed.inject(HiddenCalendarProvidersService);
      expect(fresh.hiddenProviderIds()).toEqual([]);
    });

    it('should handle non-array JSON in localStorage gracefully', () => {
      localStorage.setItem(LS.HIDDEN_CALENDAR_PROVIDER_IDS, JSON.stringify({ id: 'x' }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [HiddenCalendarProvidersService] });
      const fresh = TestBed.inject(HiddenCalendarProvidersService);
      expect(fresh.hiddenProviderIds()).toEqual([]);
    });
  });
});
