import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { PluginBridgeService } from './plugin-bridge.service';
import {
  SimpleCounter,
  SimpleCounterType,
} from '../features/simple-counter/simple-counter.model';
import { EMPTY_SIMPLE_COUNTER } from '../features/simple-counter/simple-counter.const';
import { SnackService } from '../core/snack/snack.service';
import { NotifyService } from '../core/notify/notify.service';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { TaskService } from '../features/tasks/task.service';
import { ProjectService } from '../features/project/project.service';
import { TagService } from '../features/tag/tag.service';
import { WorkContextService } from '../features/work-context/work-context.service';
import { PluginHooksService } from './plugin-hooks';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { PluginConfigService } from './plugin-config.service';
import { TaskArchiveService } from '../features/archive/task-archive.service';
import { TranslateService } from '@ngx-translate/core';
import { SyncWrapperService } from '../imex/sync/sync-wrapper.service';
import { Injector } from '@angular/core';
import { getDbDateStr } from '../util/get-db-date-str';

/* eslint-disable @typescript-eslint/naming-convention */
describe('PluginBridgeService.setCounter()', () => {
  let service: PluginBridgeService;
  let store: jasmine.SpyObj<Store>;

  const createMockCounter = (
    id: string,
    countOnDay: Record<string, number> = {},
  ): SimpleCounter => ({
    ...EMPTY_SIMPLE_COUNTER,
    id,
    title: id,
    isEnabled: true,
    type: SimpleCounterType.ClickCounter,
    countOnDay,
  });

  const getToday = (): string => getDbDateStr();

  beforeEach(() => {
    const storeSpy = jasmine.createSpyObj('Store', ['select', 'dispatch']);
    const taskServiceSpy = jasmine.createSpyObj('TaskService', ['allTasks$']);
    const projectServiceSpy = jasmine.createSpyObj('ProjectService', ['list$']);
    const tagServiceSpy = jasmine.createSpyObj('TagService', ['getTags$']);
    const workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [
      'activeWorkContext$',
    ]);

    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        { provide: Store, useValue: storeSpy },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: ProjectService, useValue: projectServiceSpy },
        { provide: TagService, useValue: tagServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        {
          provide: NotifyService,
          useValue: jasmine.createSpyObj('NotifyService', ['notify']),
        },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        {
          provide: PluginHooksService,
          useValue: jasmine.createSpyObj('PluginHooksService', ['registerHook']),
        },
        {
          provide: PluginUserPersistenceService,
          useValue: jasmine.createSpyObj('PluginUserPersistenceService', ['get', 'set']),
        },
        {
          provide: PluginConfigService,
          useValue: jasmine.createSpyObj('PluginConfigService', ['get', 'set']),
        },
        {
          provide: TaskArchiveService,
          useValue: jasmine.createSpyObj('TaskArchiveService', ['getAll']),
        },
        {
          provide: TranslateService,
          useValue: jasmine.createSpyObj('TranslateService', ['instant']),
        },
        {
          provide: SyncWrapperService,
          useValue: jasmine.createSpyObj('SyncWrapperService', ['sync']),
        },
        Injector,
      ],
    });

    service = TestBed.inject(PluginBridgeService);
    store = TestBed.inject(Store) as jasmine.SpyObj<Store>;

    // Default: return empty counter list
    store.select.and.returnValue(of([]));
  });

  describe('input validation', () => {
    it('should throw error for invalid counter ID with special characters', async () => {
      await expectAsync(service.setCounter('invalid@id!', 5)).toBeRejectedWithError(
        'Invalid counter key: must be alphanumeric with hyphens',
      );
    });

    it('should throw error for ID with spaces', async () => {
      await expectAsync(service.setCounter('invalid id', 5)).toBeRejectedWithError(
        'Invalid counter key: must be alphanumeric with hyphens',
      );
    });

    it('should throw error for negative value', async () => {
      await expectAsync(service.setCounter('valid-id', -5)).toBeRejectedWithError(
        'Invalid counter value: must be a non-negative number',
      );
    });

    it('should throw error for NaN value', async () => {
      await expectAsync(service.setCounter('valid-id', NaN)).toBeRejectedWithError(
        'Invalid counter value: must be a non-negative number',
      );
    });

    it('should throw error for Infinity value', async () => {
      await expectAsync(service.setCounter('valid-id', Infinity)).toBeRejectedWithError(
        'Invalid counter value: must be a non-negative number',
      );
    });

    it('should accept valid alphanumeric ID with hyphens and underscores', async () => {
      await service.setCounter('Valid_Counter-123', 10);
      expect(store.dispatch).toHaveBeenCalled();
    });
  });

  describe('creating new counter', () => {
    it('should dispatch upsertSimpleCounter for new counter', async () => {
      const today = getToday();

      await service.setCounter('new-counter', 42);

      expect(store.dispatch).toHaveBeenCalled();
      const call = store.dispatch.calls.mostRecent();

      const action = call.args[0] as any;
      expect(action.type).toBe('[SimpleCounter] Upsert SimpleCounter');
      expect(action.simpleCounter.id).toBe('new-counter');
      expect(action.simpleCounter.title).toBe('new-counter');
      expect(action.simpleCounter.isEnabled).toBe(true);
      expect(action.simpleCounter.type).toBe(SimpleCounterType.ClickCounter);
      expect(action.simpleCounter.countOnDay[today]).toBe(42);
    });

    it('should set counter value to 0 for new counter', async () => {
      const today = getToday();

      await service.setCounter('zero-counter', 0);

      expect(store.dispatch).toHaveBeenCalled();
      const call = store.dispatch.calls.mostRecent();

      const action = call.args[0] as any;
      expect(action.type).toBe('[SimpleCounter] Upsert SimpleCounter');
      expect(action.simpleCounter.id).toBe('zero-counter');
      expect(action.simpleCounter.countOnDay[today]).toBe(0);
    });

    it('should create counter with all required SimpleCounter fields', async () => {
      await service.setCounter('full-counter', 5);

      const call = store.dispatch.calls.mostRecent();

      const action = call.args[0] as any;
      const counter = action.simpleCounter;

      // Verify all mandatory fields are present
      expect(counter.id).toBe('full-counter');
      expect(counter.title).toBe('full-counter');
      expect(counter.isEnabled).toBe(true);
      expect(counter.type).toBe(SimpleCounterType.ClickCounter);
      expect(typeof counter.countOnDay).toBe('object');
    });
  });

  describe('updating existing counter', () => {
    it('should dispatch updateSimpleCounter for existing counter', async () => {
      const existingCounter = createMockCounter('existing-counter', { '2024-01-01': 10 });
      store.select.and.returnValue(of([existingCounter]));

      const today = getToday();

      await service.setCounter('existing-counter', 25);

      expect(store.dispatch).toHaveBeenCalled();
      const call = store.dispatch.calls.mostRecent();

      const action = call.args[0] as any;
      expect(action.type).toBe('[SimpleCounter] Update SimpleCounter');
      expect(action.simpleCounter.id).toBe('existing-counter');
      expect(action.simpleCounter.changes.countOnDay['2024-01-01']).toBe(10);
      expect(action.simpleCounter.changes.countOnDay[today]).toBe(25);
    });

    it('should preserve other days when updating existing counter', async () => {
      const existingCounter = createMockCounter('my-counter', {
        '2024-01-01': 5,
        '2024-01-02': 10,
        '2024-01-03': 15,
      });
      store.select.and.returnValue(of([existingCounter]));

      const today = getToday();

      await service.setCounter('my-counter', 99);

      expect(store.dispatch).toHaveBeenCalled();
      const call = store.dispatch.calls.mostRecent();

      const action = call.args[0] as any;
      const countOnDay = action.simpleCounter.changes.countOnDay;
      expect(countOnDay['2024-01-01']).toBe(5);
      expect(countOnDay['2024-01-02']).toBe(10);
      expect(countOnDay['2024-01-03']).toBe(15);
      expect(countOnDay[today]).toBe(99);
    });

    it('should overwrite today value if already set', async () => {
      const today = getToday();
      const existingCounter = createMockCounter('today-counter', { [today]: 50 });
      store.select.and.returnValue(of([existingCounter]));

      await service.setCounter('today-counter', 100);

      expect(store.dispatch).toHaveBeenCalled();
      const call = store.dispatch.calls.mostRecent();

      const action = call.args[0] as any;
      expect(action.simpleCounter.changes.countOnDay[today]).toBe(100);
    });

    it('should use updateSimpleCounter action not upsertSimpleCounter for existing', async () => {
      const existingCounter = createMockCounter('check-action', {});
      store.select.and.returnValue(of([existingCounter]));

      await service.setCounter('check-action', 1);

      const call = store.dispatch.calls.mostRecent();

      const action = call.args[0] as any;
      expect(action.type).toBe('[SimpleCounter] Update SimpleCounter');
    });
  });
});
