export const TASK_HISTORY_PLUGIN_ID = 'task-history';
export const OPTIONAL_TASK_HISTORY_FIELDS = ['title', 'priority', 'notes'] as const;
type OptionalTaskHistoryField = (typeof OPTIONAL_TASK_HISTORY_FIELDS)[number];
export type TaskHistoryRecordingConfig = Partial<
  Record<OptionalTaskHistoryField, boolean>
>;

const STORAGE_PREFIX = 'sp.taskHistory.';
const BOOLEAN_KEYS = ['recordTitle', 'recordPriority', 'recordNotes'] as const;

/** Recording consent belongs to this device; a synced preference cannot opt it in. */
export const readTaskHistoryPreferences = (): Record<string, unknown> => {
  try {
    return {
      recordTitle: localStorage.getItem(STORAGE_PREFIX + 'recordTitle') === 'true',
      recordPriority: localStorage.getItem(STORAGE_PREFIX + 'recordPriority') === 'true',
      recordNotes: localStorage.getItem(STORAGE_PREFIX + 'recordNotes') === 'true',
      order:
        localStorage.getItem(STORAGE_PREFIX + 'order') === 'oldest' ? 'oldest' : 'newest',
    };
  } catch {
    return {
      recordTitle: false,
      recordPriority: false,
      recordNotes: false,
      order: 'newest',
    };
  }
};

/** Save only changed fields, so a stale dialog cannot overwrite untouched consent. */
export const saveTaskHistoryPreferences = (patch: Record<string, unknown>): void => {
  for (const key of BOOLEAN_KEYS) {
    if (typeof patch[key] === 'boolean')
      localStorage.setItem(STORAGE_PREFIX + key, String(patch[key]));
  }
  const order = patch['order'];
  if (order === 'newest' || order === 'oldest')
    localStorage.setItem(STORAGE_PREFIX + 'order', order);
};

export const clearTaskHistoryRecordingConsent = (): void => {
  try {
    for (const key of BOOLEAN_KEYS) localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // An unavailable store cannot enable recording.
  }
};

export const readTaskHistoryRecordingConfig = (): TaskHistoryRecordingConfig => {
  const config = readTaskHistoryPreferences();
  return {
    title: config['recordTitle'] === true,
    priority: config['recordPriority'] === true,
    notes: config['recordNotes'] === true,
  };
};
