import typia from 'typia';
import { TaskHistoryEnvelope } from './task-history.model';
import { isValidDBDateStr } from '../../../util/get-db-date-str';

/** The history envelope is untrusted synced input, just like the task payload. */
export const isTaskHistoryEnvelope = (
  value: unknown,
  operationId?: string,
): value is TaskHistoryEnvelope => {
  if (!typia.is<TaskHistoryEnvelope>(value)) return false;
  if (!value.operationId || (operationId && value.operationId !== operationId))
    return false;
  if (!Number.isFinite(value.occurredAt)) return false;
  const validValue = (v: TaskHistoryEnvelope['events'][number]['before']): boolean =>
    v.kind === 'time'
      ? Number.isFinite(v.value)
      : v.kind !== 'day' || isValidDBDateStr(v.value);
  const validField = (
    field: TaskHistoryEnvelope['events'][number]['field'],
    v: TaskHistoryEnvelope['events'][number]['before'],
  ): boolean =>
    validValue(v) &&
    (v.kind === 'unknown' ||
      (field === 'status' ? v.kind === 'status' : v.kind !== 'status'));
  const baselineIds = new Set(value.baselines.map((b) => b.taskId));
  return (
    value.baselines.every(
      (b) =>
        !!b.taskId &&
        b.id.endsWith(`:${encodeURIComponent(b.taskId)}:baseline`) &&
        Number.isFinite(b.observedAt) &&
        Number.isFinite(b.createdAt) &&
        validField('status', b.status) &&
        validField('schedule', b.schedule) &&
        validField('deadline', b.deadline),
    ) &&
    (value.gaps ?? []).every(
      (g) =>
        baselineIds.has(g.taskId) &&
        g.id === `recording-unavailable:${encodeURIComponent(g.taskId)}` &&
        (g.detectedAt === null || Number.isFinite(g.detectedAt)),
    ) &&
    value.events.every(
      (e) =>
        baselineIds.has(e.taskId) &&
        e.operationId === value.operationId &&
        e.id === `${value.operationId}:${encodeURIComponent(e.taskId)}:${e.field}` &&
        e.occurredAt === value.occurredAt &&
        validField(e.field, e.before) &&
        validField(e.field, e.after),
    )
  );
};
