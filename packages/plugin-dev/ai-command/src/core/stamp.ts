// The stale check of § 6.6: a row applies only if its task still holds the
// values it had when the model saw it.

import type { TaskLike, TaskStamp } from './types';

export const stampOf = (t: TaskLike): TaskStamp => ({
  title: t.title,
  isDone: !!t.isDone,
  timeEstimate: t.timeEstimate || 0,
  projectId: t.projectId || null,
  tagIds: [...(t.tagIds || [])].sort(),
  parentId: t.parentId || null,
  // A delete takes the subtasks with it, so a new one makes the row stale.
  subTaskIds: [...(t.subTaskIds || [])].sort(),
  dueDay: t.dueDay || null,
  dueWithTime: t.dueWithTime || null,
  remindAt: t.remindAt || null,
  deadline: t.deadlineDay || (t.deadlineWithTime ? String(t.deadlineWithTime) : null),
  repeatCfgId: t.repeatCfgId || null,
});

export const isSameStamp = (a: TaskStamp, b: TaskStamp): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
