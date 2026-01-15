import { reminderReducer, initialReminderState, ReminderState } from './reminder.reducer';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { Reminder } from '../reminder.model';
import { AppDataCompleteLegacy } from '../../../imex/sync/sync.model';

const createReminder = (id: string, partial: Partial<Reminder> = {}): Reminder => ({
  id,
  remindAt: Date.now() + 3600000,
  title: `Reminder ${id}`,
  type: 'TASK',
  relatedId: `task-${id}`,
  ...partial,
});

describe('ReminderReducer', () => {
  describe('initial state', () => {
    it('should return empty array for unknown action', () => {
      const action = { type: 'UNKNOWN' };
      const result = reminderReducer(initialReminderState, action);

      expect(result).toEqual([]);
    });

    it('should have empty initial state', () => {
      expect(initialReminderState).toEqual([]);
    });
  });

  describe('loadAllData', () => {
    it('should load reminders when available', () => {
      const reminders: Reminder[] = [
        createReminder('reminder1', { title: 'First Reminder' }),
        createReminder('reminder2', { title: 'Second Reminder', type: 'NOTE' }),
      ];
      const appDataComplete = { reminders } as AppDataCompleteLegacy;

      const action = loadAllData({ appDataComplete });
      const result = reminderReducer(initialReminderState, action);

      expect(result.length).toBe(2);
      expect(result[0]).toEqual(reminders[0]);
      expect(result[1]).toEqual(reminders[1]);
    });

    it('should return initial state when reminders is undefined', () => {
      const appDataComplete = {
        reminders: undefined,
      } as unknown as AppDataCompleteLegacy;

      const action = loadAllData({ appDataComplete });
      const result = reminderReducer(initialReminderState, action);

      expect(result).toEqual(initialReminderState);
    });

    it('should return initial state when reminders is null', () => {
      const appDataComplete = { reminders: null } as unknown as AppDataCompleteLegacy;

      const action = loadAllData({ appDataComplete });
      const result = reminderReducer(initialReminderState, action);

      expect(result).toEqual(initialReminderState);
    });

    it('should handle empty reminders array', () => {
      const appDataComplete = { reminders: [] } as unknown as AppDataCompleteLegacy;

      const action = loadAllData({ appDataComplete });
      const result = reminderReducer(initialReminderState, action);

      expect(result).toEqual([]);
    });

    it('should replace existing state with loaded reminders', () => {
      const existingState: ReminderState = [createReminder('existing')];
      const newReminders: Reminder[] = [createReminder('new1'), createReminder('new2')];
      const appDataComplete = { reminders: newReminders } as AppDataCompleteLegacy;

      const action = loadAllData({ appDataComplete });
      const result = reminderReducer(existingState, action);

      expect(result.length).toBe(2);
      expect(result).toEqual(newReminders);
    });
  });

  describe('unknown action', () => {
    it('should return current state unchanged', () => {
      const existingState: ReminderState = [createReminder('reminder1')];
      const action = { type: 'SOME_OTHER_ACTION' };

      const result = reminderReducer(existingState, action);

      expect(result).toBe(existingState);
    });
  });
});
