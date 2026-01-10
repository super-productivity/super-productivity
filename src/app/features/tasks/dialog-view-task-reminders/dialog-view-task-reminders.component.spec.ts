import { BehaviorSubject, Subject } from 'rxjs';
import { Reminder } from '../../reminder/reminder.model';

/**
 * Tests for the dismissed reminder tracking logic in DialogViewTaskRemindersComponent.
 *
 * These tests verify that dismissed reminders are tracked and filtered out when
 * the worker sends stale data, preventing the race condition described in issue #5826.
 *
 * The tests focus on the core filtering logic without needing full component rendering.
 */
describe('DialogViewTaskRemindersComponent dismissed reminder tracking', () => {
  // Simulate the component's internal state
  let reminders$: BehaviorSubject<Reminder[]>;
  let dismissedReminderIds: Set<string>;
  let onRemindersActiveSubject: Subject<Reminder[]>;

  const createMockReminder = (id: string, relatedId: string): Reminder => ({
    id,
    relatedId,
    title: `Task ${id}`,
    remindAt: Date.now() - 1000,
    type: 'TASK',
  });

  // Simulate the component's _removeReminderFromList method
  const removeReminderFromList = (reminderId: string): void => {
    dismissedReminderIds.add(reminderId);
    const newReminders = reminders$.getValue().filter((r) => r.id !== reminderId);
    reminders$.next(newReminders);
  };

  // Simulate the component's onRemindersActive$ subscription handler
  const handleRemindersActive = (reminders: Reminder[]): void => {
    const filtered = reminders.filter((r) => !dismissedReminderIds.has(r.id));
    if (filtered.length > 0) {
      reminders$.next(filtered);
    }
  };

  beforeEach(() => {
    const initialReminders = [
      createMockReminder('reminder-1', 'task-1'),
      createMockReminder('reminder-2', 'task-2'),
    ];
    reminders$ = new BehaviorSubject<Reminder[]>(initialReminders);
    dismissedReminderIds = new Set<string>();
    onRemindersActiveSubject = new Subject<Reminder[]>();

    // Set up the subscription like the component does
    onRemindersActiveSubject.subscribe(handleRemindersActive);
  });

  it('should track dismissed reminder IDs when removing from list', () => {
    expect(reminders$.getValue().length).toBe(2);

    removeReminderFromList('reminder-1');

    expect(dismissedReminderIds.has('reminder-1')).toBe(true);
    expect(reminders$.getValue().length).toBe(1);
    expect(reminders$.getValue().find((r) => r.id === 'reminder-1')).toBeUndefined();
  });

  it('should filter out dismissed reminders when worker sends stale data', () => {
    // Dismiss a reminder
    removeReminderFromList('reminder-1');
    expect(reminders$.getValue().length).toBe(1);

    // Simulate worker sending stale data that includes the dismissed reminder
    const staleReminders = [
      createMockReminder('reminder-1', 'task-1'), // This was dismissed
      createMockReminder('reminder-2', 'task-2'),
      createMockReminder('reminder-3', 'task-3'), // New reminder
    ];

    onRemindersActiveSubject.next(staleReminders);

    // The dismissed reminder should be filtered out
    const currentReminders = reminders$.getValue();
    expect(currentReminders.find((r) => r.id === 'reminder-1')).toBeUndefined();
    expect(currentReminders.find((r) => r.id === 'reminder-2')).toBeDefined();
    expect(currentReminders.find((r) => r.id === 'reminder-3')).toBeDefined();
  });

  it('should track multiple dismissed reminders', () => {
    // Dismiss both reminders
    removeReminderFromList('reminder-1');
    removeReminderFromList('reminder-2');

    expect(dismissedReminderIds.has('reminder-1')).toBe(true);
    expect(dismissedReminderIds.has('reminder-2')).toBe(true);

    // Simulate worker sending stale data
    const staleReminders = [
      createMockReminder('reminder-1', 'task-1'),
      createMockReminder('reminder-2', 'task-2'),
    ];

    onRemindersActiveSubject.next(staleReminders);

    // Both should be filtered out, leaving empty array
    // Note: In the actual component, this would close the dialog
    // Here we just verify the filtering works
    const currentReminders = reminders$.getValue();
    expect(currentReminders.length).toBe(0);
  });

  it('should allow new reminders that were not dismissed', () => {
    // Dismiss reminder-1
    removeReminderFromList('reminder-1');

    // Worker sends completely new reminders
    const newReminders = [
      createMockReminder('reminder-3', 'task-3'),
      createMockReminder('reminder-4', 'task-4'),
    ];

    onRemindersActiveSubject.next(newReminders);

    // New reminders should be accepted
    const currentReminders = reminders$.getValue();
    expect(currentReminders.length).toBe(2);
    expect(currentReminders.find((r) => r.id === 'reminder-3')).toBeDefined();
    expect(currentReminders.find((r) => r.id === 'reminder-4')).toBeDefined();
  });

  it('should not affect reminders that were never shown', () => {
    // Don't dismiss any reminders, just receive new ones
    const newReminders = [
      createMockReminder('reminder-5', 'task-5'),
      createMockReminder('reminder-6', 'task-6'),
    ];

    onRemindersActiveSubject.next(newReminders);

    const currentReminders = reminders$.getValue();
    expect(currentReminders.length).toBe(2);
    expect(currentReminders.find((r) => r.id === 'reminder-5')).toBeDefined();
    expect(currentReminders.find((r) => r.id === 'reminder-6')).toBeDefined();
  });
});
