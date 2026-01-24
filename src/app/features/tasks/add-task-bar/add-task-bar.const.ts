import { INBOX_PROJECT } from '../../project/project.const';
import { TimeSpentOnDay, TaskReminderOptionId } from '../task.model';
import { TaskAttachment } from '../task-attachment/task-attachment.model';

export interface AddTaskBarState {
  projectId: string;
  tagIds: string[];
  tagIdsFromTxt: string[];
  date: string | null;
  time: string | null;
  spent: TimeSpentOnDay | null;
  estimate: number | null;
  newTagTitles: string[];
  cleanText: string | null;
  remindOption: TaskReminderOptionId | null;
  attachments: TaskAttachment[];
}
export const ESTIMATE_OPTIONS = [
  { label: '5m', value: '5m' },
  { label: '10m', value: '10m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
  { label: '2h', value: '2h' },
  { label: '3h', value: '3h' },
  { label: '4h', value: '4h' },
  { label: '8h', value: '8h' },
];

export const INITIAL_ADD_TASK_BAR_STATE: AddTaskBarState = {
  projectId: INBOX_PROJECT.id,
  tagIds: [],
  tagIdsFromTxt: [],
  date: null,
  time: null,
  spent: null,
  estimate: null,
  newTagTitles: [],
  cleanText: null,
  remindOption: null,
  attachments: [],
};

export const CHRONO_SUGGESTIONS: string[] = [
  // Relative Days
  'today',
  'tomorrow',
  'yesterday',
  'tonight',
  'this morning',
  'this afternoon',
  'this evening',

  // Relative Weeks
  'next week',
  'last week',
  'this week',
  'next weekend',
  'last weekend',

  // Days of Week
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'next monday',
  'next friday',
  'last monday',
  'last friday',

  // Months
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'next january',
  'last december',

  // Relative Time
  'in 5 minutes',
  'in 15 minutes',
  'in 30 minutes',
  'in 1 hour',
  'in 2 hours',
  'in 3 hours',
  'in 1 day',
  'in 2 days',
  'in 3 days',
  'in 1 week',
  'in 2 weeks',
  'in 1 month',

  // Absolute Times
  'at 7am',
  'at 9am',
  'at noon',
  'at 3pm',
  'at 5pm',
  'at 7pm',
  'at 9pm',
  'at midnight',

  // Special
  'now',
  'asap',
  'later',
  'soon',
  'end of day',
  'end of week',
  'end of month',
  'end of year',
];
