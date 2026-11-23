import { MsTodoImportModel, MsTodoTask } from '../parse/normalized-model';
import { buildLossyNotes } from './build-lossy-notes';

const task = (overrides: Partial<MsTodoTask>): MsTodoTask => ({
  extId: 't1',
  projectExtId: 'p1',
  parentExtId: null,
  title: 'task',
  notes: '',
  isDone: false,
  categories: [],
  isImportant: false,
  dueDay: null,
  isRecurring: false,
  repeat: null,
  hasReminder: false,
  hasAttachments: false,
  ...overrides,
});

const model: MsTodoImportModel = {
  projects: [
    {
      extId: 'p1',
      title: 'A',
      isDefault: false,
      isFlaggedEmails: false,
      truncatedFieldCount: 1,
    },
    { extId: 'p2', title: 'B', isDefault: false, isFlaggedEmails: false },
  ],
  tasks: [
    task({ extId: 'a', hasReminder: true, hasAttachments: true }),
    task({ extId: 'b', isRecurring: true }),
    task({
      extId: 'c',
      isRecurring: true,
      repeat: { schedule: { quickSetting: 'DAILY' }, notesWithRule: '' },
    }),
    task({ extId: 'd', projectExtId: 'p2', hasReminder: true }),
  ],
};

describe('buildLossyNotes', () => {
  it('counts losses of selected lists only, leaving out repeats that carry over', () => {
    expect(buildLossyNotes(model, new Set(['p1']))).toEqual([
      { key: 'LOSS.RECURRING', params: { count: 1 } },
      { key: 'LOSS.REMINDERS', params: { count: 1 } },
      { key: 'LOSS.ATTACHMENTS', params: { count: 1 } },
      { key: 'LOSS.TRUNCATED_FIELDS', params: { count: 1 } },
      { key: 'LOSS.ALWAYS' },
    ]);
    expect(buildLossyNotes(model, new Set(['p2']))).toEqual([
      { key: 'LOSS.REMINDERS', params: { count: 1 } },
      { key: 'LOSS.ALWAYS' },
    ]);
  });
});
