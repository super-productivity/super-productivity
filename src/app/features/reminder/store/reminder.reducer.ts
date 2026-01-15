import { createFeatureSelector, createReducer, on } from '@ngrx/store';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { Reminder } from '../reminder.model';

export type ReminderState = Reminder[];

export const REMINDER_FEATURE_NAME = 'reminders';

export const initialReminderState: ReminderState = [];

export const reminderReducer = createReducer(
  initialReminderState,
  on(loadAllData, (_state, { appDataComplete }) =>
    appDataComplete.reminders ? appDataComplete.reminders : initialReminderState,
  ),
);

export const selectReminderFeatureState =
  createFeatureSelector<ReminderState>(REMINDER_FEATURE_NAME);
