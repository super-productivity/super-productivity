import { TestBed } from '@angular/core/testing';
import { TaskWidgetSettingsService } from './task-widget-settings.service';

const STORAGE_KEY = 'sp_task_widget_settings';

describe('TaskWidgetSettingsService', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('returns default settings when localStorage is empty', () => {
    const service = TestBed.inject(TaskWidgetSettingsService);

    expect(service.settings()).toEqual({
      isTaskListEnabled: false,
      taskListFilter: 'all',
      isTaskListCollapsed: false,
      isEnabled: false,
      isAlwaysShow: false,
      opacity: 95,
    });
  });

  it('loads existing settings from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ isEnabled: true, opacity: 70 }));

    const service = TestBed.inject(TaskWidgetSettingsService);

    expect(service.settings()).toEqual({
      isTaskListEnabled: false,
      taskListFilter: 'all',
      isTaskListCollapsed: false,
      isEnabled: true,
      isAlwaysShow: false,
      opacity: 70,
    });
  });

  it('merges partial updates and persists them', () => {
    const service = TestBed.inject(TaskWidgetSettingsService);

    service.update({ isEnabled: true, opacity: 50 });

    expect(service.settings()).toEqual({
      isTaskListEnabled: false,
      taskListFilter: 'all',
      isTaskListCollapsed: false,
      isEnabled: true,
      isAlwaysShow: false,
      opacity: 50,
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      isTaskListEnabled: false,
      taskListFilter: 'all',
      isTaskListCollapsed: false,
      isEnabled: true,
      isAlwaysShow: false,
      opacity: 50,
    });
  });

  it('keeps the list independent from the timer and restores collapsed state', () => {
    const service = TestBed.inject(TaskWidgetSettingsService);
    service.update({
      isTaskListEnabled: true,
      taskListFilter: 'today',
      isTaskListCollapsed: true,
    });
    expect(service.settings().isEnabled).toBeFalse();
    service.update({ isTaskListEnabled: false });
    expect(service.settings().isTaskListCollapsed).toBeTrue();
    TestBed.resetTestingModule();
    const restored = TestBed.inject(TaskWidgetSettingsService);
    expect(restored.settings().taskListFilter).toBe('today');
    expect(restored.settings().isTaskListCollapsed).toBeTrue();
    expect(restored.settings().isTaskListEnabled).toBeFalse();
  });

  it('falls back to defaults if stored JSON is corrupt', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json');

    const service = TestBed.inject(TaskWidgetSettingsService);

    expect(service.settings()).toEqual({
      isTaskListEnabled: false,
      taskListFilter: 'all',
      isTaskListCollapsed: false,
      isEnabled: false,
      isAlwaysShow: false,
      opacity: 95,
    });
  });
});
