import { TestBed } from '@angular/core/testing';
import { MenuBarSettingsService } from './menu-bar-settings.service';

const STORAGE_KEY = 'sp_menu_bar_settings';

describe('MenuBarSettingsService', () => {
  let updateMenuBarSettings: jasmine.Spy;

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    updateMenuBarSettings = jasmine.createSpy('updateMenuBarSettings');
    (window as any).ea = {
      ...(window as any).ea,
      isMacOS: () => true,
      updateMenuBarSettings,
    };
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    delete (window as any).ea;
  });

  it('defaults to menu-bar-only (no Dock icon)', () => {
    const service = TestBed.inject(MenuBarSettingsService);

    expect(service.settings()).toEqual({ showDockIcon: false });
  });

  it('pushes the persisted value to Electron at boot', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ showDockIcon: true }));

    TestBed.inject(MenuBarSettingsService);

    expect(updateMenuBarSettings).toHaveBeenCalledWith({ showDockIcon: true });
  });

  it('persists and pushes updates', () => {
    const service = TestBed.inject(MenuBarSettingsService);

    service.update({ showDockIcon: true });

    expect(service.settings()).toEqual({ showDockIcon: true });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      showDockIcon: true,
    });
    expect(updateMenuBarSettings).toHaveBeenCalledWith({ showDockIcon: true });
  });

  it('falls back to defaults if stored JSON is corrupt', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json');

    const service = TestBed.inject(MenuBarSettingsService);

    expect(service.settings()).toEqual({ showDockIcon: false });
  });
});
