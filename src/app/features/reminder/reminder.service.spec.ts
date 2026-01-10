import { TestBed } from '@angular/core/testing';
import { ReminderService } from './reminder.service';
import { PfapiService } from '../../pfapi/pfapi.service';
import { SnackService } from '../../core/snack/snack.service';
import { TaskService } from '../tasks/task.service';
import { NoteService } from '../note/note.service';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { GlobalConfigService } from '../config/global-config.service';
import { of } from 'rxjs';

describe('ReminderService', () => {
  let service: ReminderService;
  let mockWorker: jasmine.SpyObj<Worker>;
  let pfapiServiceSpy: jasmine.SpyObj<PfapiService>;

  beforeEach(() => {
    // Create mock worker
    mockWorker = jasmine.createSpyObj('Worker', ['postMessage', 'addEventListener']);

    // Mock Worker constructor
    spyOn(window, 'Worker').and.returnValue(mockWorker as any);

    // Create spies for dependencies
    pfapiServiceSpy = jasmine.createSpyObj('PfapiService', [], {
      m: {
        reminders: {
          load: jasmine.createSpy('load').and.returnValue(Promise.resolve([])),
          save: jasmine.createSpy('save').and.returnValue(Promise.resolve()),
        },
      },
    });

    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    const taskServiceSpy = jasmine.createSpyObj('TaskService', ['getByIdOnce$']);
    taskServiceSpy.getByIdOnce$.and.returnValue(of(null));

    const noteServiceSpy = jasmine.createSpyObj('NoteService', ['getByIdOnce$']);
    noteServiceSpy.getByIdOnce$.and.returnValue(of(null));

    const imexViewServiceSpy = jasmine.createSpyObj('ImexViewService', [], {
      isDataImportInProgress$: of(false),
    });

    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', ['cfg']);
    globalConfigServiceSpy.cfg.and.returnValue({ reminder: { disableReminders: false } });

    TestBed.configureTestingModule({
      providers: [
        ReminderService,
        { provide: PfapiService, useValue: pfapiServiceSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: NoteService, useValue: noteServiceSpy },
        { provide: ImexViewService, useValue: imexViewServiceSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
      ],
    });

    service = TestBed.inject(ReminderService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('immediate worker updates to prevent race conditions', () => {
    beforeEach(async () => {
      // Initialize service to set up internal state
      await service.init();
      mockWorker.postMessage.calls.reset();
    });

    it('should update worker immediately when removing a reminder', () => {
      // Add a reminder first
      const reminderId = service.addReminder(
        'TASK',
        'task-123',
        'Test Task',
        Date.now() + 60000,
      );
      mockWorker.postMessage.calls.reset();

      // Remove the reminder
      service.removeReminder(reminderId);

      // Worker should be updated immediately (first call), before _saveModel completes
      expect(mockWorker.postMessage).toHaveBeenCalled();
      const firstCallArgs = mockWorker.postMessage.calls.first().args[0];
      expect(Array.isArray(firstCallArgs)).toBe(true);
      expect(firstCallArgs.find((r: any) => r.id === reminderId)).toBeUndefined();
    });

    it('should update worker immediately when updating a reminder', () => {
      // Add a reminder first
      const reminderId = service.addReminder(
        'TASK',
        'task-456',
        'Test Task',
        Date.now() + 60000,
      );
      mockWorker.postMessage.calls.reset();

      const newRemindAt = Date.now() + 120000;

      // Update the reminder
      service.updateReminder(reminderId, { remindAt: newRemindAt });

      // Worker should be updated immediately
      expect(mockWorker.postMessage).toHaveBeenCalled();
      const firstCallArgs = mockWorker.postMessage.calls.first().args[0];
      const updatedReminder = firstCallArgs.find((r: any) => r.id === reminderId);
      expect(updatedReminder).toBeDefined();
      expect(updatedReminder.remindAt).toBe(newRemindAt);
    });

    it('should update worker immediately when adding a reminder', () => {
      mockWorker.postMessage.calls.reset();

      // Add a reminder
      const reminderId = service.addReminder(
        'TASK',
        'task-789',
        'New Task',
        Date.now() + 60000,
      );

      // Worker should be updated immediately
      expect(mockWorker.postMessage).toHaveBeenCalled();
      const firstCallArgs = mockWorker.postMessage.calls.first().args[0];
      const addedReminder = firstCallArgs.find((r: any) => r.id === reminderId);
      expect(addedReminder).toBeDefined();
      expect(addedReminder.title).toBe('New Task');
    });

    it('should update worker immediately when snoozing a reminder', () => {
      // Add a reminder first
      const reminderId = service.addReminder(
        'TASK',
        'task-snooze',
        'Snooze Task',
        Date.now() - 1000, // Already due
      );
      mockWorker.postMessage.calls.reset();

      const snoozeTime = 5 * 60 * 1000; // 5 minutes
      const beforeSnooze = Date.now();

      // Snooze the reminder
      service.snooze(reminderId, snoozeTime);

      // Worker should be updated immediately
      expect(mockWorker.postMessage).toHaveBeenCalled();
      const firstCallArgs = mockWorker.postMessage.calls.first().args[0];
      const snoozedReminder = firstCallArgs.find((r: any) => r.id === reminderId);
      expect(snoozedReminder).toBeDefined();
      expect(snoozedReminder.remindAt).toBeGreaterThanOrEqual(beforeSnooze + snoozeTime);
    });
  });

  describe('duplicate reminder prevention', () => {
    let messageHandler: (msg: MessageEvent) => Promise<void>;
    let taskServiceSpy: jasmine.SpyObj<TaskService>;

    beforeEach(async () => {
      // Initialize service first to register the message handler
      await service.init();

      // Capture the message handler registered on the worker
      const call = mockWorker.addEventListener.calls
        .all()
        .find((c) => c.args[0] === 'message');
      messageHandler = call?.args[1] as unknown as (msg: MessageEvent) => Promise<void>;

      // Get TaskService spy to configure task responses
      taskServiceSpy = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
    });

    it('should not emit duplicate reminders when worker sends same reminder twice', async () => {
      const testReminder = {
        id: 'reminder-dup-1',
        relatedId: 'task-dup-1',
        title: 'Duplicate Test',
        remindAt: Date.now() - 1000,
        type: 'TASK' as const,
      };

      // Mock task exists and is not done
      taskServiceSpy.getByIdOnce$.and.returnValue(
        of({ id: 'task-dup-1', isDone: false } as any),
      );

      const emissions: any[] = [];
      service.onRemindersActive$.subscribe((reminders) => {
        emissions.push(reminders);
      });

      // Simulate worker sending same reminder twice (race condition)
      await messageHandler({ data: [testReminder] } as MessageEvent);
      await messageHandler({ data: [testReminder] } as MessageEvent);

      // Should only have one emission
      expect(emissions.length).toBe(1);
      expect(emissions[0].length).toBe(1);
      expect(emissions[0][0].id).toBe('reminder-dup-1');
    });

    it('should allow reminder to emit again after snooze', async () => {
      const reminderId = service.addReminder(
        'TASK',
        'task-snooze-emit',
        'Snooze Emit Test',
        Date.now() - 1000,
      );

      const testReminder = {
        id: reminderId,
        relatedId: 'task-snooze-emit',
        title: 'Snooze Emit Test',
        remindAt: Date.now() - 1000,
        type: 'TASK' as const,
      };

      // Mock task exists and is not done
      taskServiceSpy.getByIdOnce$.and.returnValue(
        of({ id: 'task-snooze-emit', isDone: false } as any),
      );

      const emissions: any[] = [];
      service.onRemindersActive$.subscribe((reminders) => {
        emissions.push(reminders);
      });

      // First activation
      await messageHandler({ data: [testReminder] } as MessageEvent);
      expect(emissions.length).toBe(1);

      // Snooze the reminder (this should clear the processed state)
      service.snooze(reminderId, 5000);

      // Update the reminder time for the "new" activation
      const snoozedReminder = { ...testReminder, remindAt: Date.now() - 500 };

      // Second activation after snooze should work
      await messageHandler({ data: [snoozedReminder] } as MessageEvent);
      expect(emissions.length).toBe(2);
    });

    it('should clean up processed state after timeout', async () => {
      jasmine.clock().install();

      const testReminder = {
        id: 'reminder-cleanup-1',
        relatedId: 'task-cleanup-1',
        title: 'Cleanup Test',
        remindAt: Date.now() - 1000,
        type: 'TASK' as const,
      };

      taskServiceSpy.getByIdOnce$.and.returnValue(
        of({ id: 'task-cleanup-1', isDone: false } as any),
      );

      const emissions: any[] = [];
      service.onRemindersActive$.subscribe((reminders) => {
        emissions.push(reminders);
      });

      // First activation
      await messageHandler({ data: [testReminder] } as MessageEvent);
      expect(emissions.length).toBe(1);

      // Second activation should be blocked
      await messageHandler({ data: [testReminder] } as MessageEvent);
      expect(emissions.length).toBe(1);

      // Advance time by 61 seconds (cleanup happens at 60s)
      jasmine.clock().tick(61000);

      // Third activation should work after cleanup
      await messageHandler({ data: [testReminder] } as MessageEvent);
      expect(emissions.length).toBe(2);

      jasmine.clock().uninstall();
    });
  });
});
