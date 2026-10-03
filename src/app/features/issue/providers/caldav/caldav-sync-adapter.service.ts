import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IssueSyncAdapter } from '../../two-way-sync/issue-sync-adapter.interface';
import {
  FieldMapping,
  FieldPushContext,
  FieldSyncConfig,
} from '../../two-way-sync/issue-sync.model';
import { Task } from '../../../tasks/task.model';
import { PlannerActions } from '../../../planner/store/planner.actions';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { CaldavCfg } from './caldav.model';
import { CaldavClientService } from './caldav-client.service';
import {
  CaldavDateValue,
  toCaldavDateValue,
  truncateToSeconds,
} from './caldav-ical-date.util';

/** What `pushChanges` hands to the client. `null` removes a date; an absent key
 * means "not part of this push". */
export interface CaldavFieldUpdates {
  completed?: boolean;
  summary?: string;
  note?: string;
  dtstart?: CaldavDateValue | null;
  due?: CaldavDateValue | null;
}

const toTimedIssueValue = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? truncateToSeconds(v) : null;
const toDayIssueValue = (v: unknown): string | null =>
  typeof v === 'string' && v ? v : null;
const toTimedTaskValue = (v: unknown): number | null =>
  typeof v === 'number' ? v : null;
const toDayTaskValue = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** DTSTART and DUE are only valid as a pair, so a held-back date is re-sent with its partner. */
const CALDAV_DATE_TASK_FIELD_LIST: (keyof Task)[] = [
  'dueDay',
  'dueWithTime',
  'deadlineDay',
  'deadlineWithTime',
];

const isTimedPlannerMove = (action: FieldPushContext['action']): boolean =>
  action.type === TaskSharedActions.scheduleTaskWithTime.type &&
  (action as ReturnType<typeof TaskSharedActions.scheduleTaskWithTime>).isPlannerMove ===
    true;

/**
 * Planned dates also change without an explicit edit, through Planner drags
 * and repeat-config scheduling, so CalDAV pushes neither (#10099). This also
 * skips explicit planned-date edits on a task with a repeat config.
 */
const skipAutomaticPlannedDate = ({ action, task }: FieldPushContext): boolean =>
  action.type === PlannerActions.transferTask.type ||
  isTimedPlannerMove(action) ||
  !!task.repeatCfgId;

/**
 * Each date pair shares one issue field, so computePushDecisions makes exactly
 * one decision per VTODO property. Timed values are `number`, all-day values
 * `string` (see CaldavDateValue), so each mapping reads back only its own kind
 * and yields `null` for the counterpart, like getAddTaskData does.
 */
const CALDAV_DATE_FIELD_MAPPINGS: FieldMapping[] = [
  {
    taskField: 'dueWithTime',
    issueField: 'dtstart',
    defaultDirection: 'pullOnly',
    toIssueValue: toTimedIssueValue,
    toTaskValue: toTimedTaskValue,
    pushTogetherWith: CALDAV_DATE_TASK_FIELD_LIST,
    skipPush: skipAutomaticPlannedDate,
  },
  {
    taskField: 'dueDay',
    issueField: 'dtstart',
    defaultDirection: 'pullOnly',
    toIssueValue: toDayIssueValue,
    toTaskValue: toDayTaskValue,
    pushTogetherWith: CALDAV_DATE_TASK_FIELD_LIST,
    skipPush: skipAutomaticPlannedDate,
  },
  {
    taskField: 'deadlineWithTime',
    issueField: 'due',
    defaultDirection: 'pullOnly',
    toIssueValue: toTimedIssueValue,
    toTaskValue: toTimedTaskValue,
    pushTogetherWith: CALDAV_DATE_TASK_FIELD_LIST,
  },
  {
    taskField: 'deadlineDay',
    issueField: 'due',
    defaultDirection: 'pullOnly',
    toIssueValue: toDayIssueValue,
    toTaskValue: toDayTaskValue,
    pushTogetherWith: CALDAV_DATE_TASK_FIELD_LIST,
  },
];

export const CALDAV_DATE_TASK_FIELDS: ReadonlySet<string> = new Set(
  CALDAV_DATE_TASK_FIELD_LIST,
);
export const CALDAV_DEADLINE_TASK_FIELDS: ReadonlySet<string> = new Set([
  'deadlineDay',
  'deadlineWithTime',
]);

export const CALDAV_FIELD_MAPPINGS: FieldMapping[] = [
  {
    taskField: 'isDone',
    issueField: 'completed',
    defaultDirection: 'pullOnly',
    toIssueValue: (taskValue: unknown): boolean => !!taskValue,
    toTaskValue: (issueValue: unknown): boolean => !!issueValue,
  },
  {
    taskField: 'title',
    issueField: 'summary',
    defaultDirection: 'pullOnly',
    toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
    toTaskValue: (issueValue: unknown): string => (issueValue as string) ?? '',
  },
  {
    taskField: 'notes',
    issueField: 'note',
    defaultDirection: 'off',
    toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
    toTaskValue: (issueValue: unknown): string => (issueValue as string) ?? '',
  },
  ...CALDAV_DATE_FIELD_MAPPINGS,
];

@Injectable({
  providedIn: 'root',
})
export class CaldavSyncAdapterService implements IssueSyncAdapter<CaldavCfg> {
  private readonly _caldavClientService = inject(CaldavClientService);

  getFieldMappings(): FieldMapping[] {
    return CALDAV_FIELD_MAPPINGS;
  }

  getSyncConfig(cfg: CaldavCfg): FieldSyncConfig {
    const twoWay = cfg.twoWaySync;
    if (!twoWay) {
      return {};
    }
    return {
      isDone: twoWay.isDone,
      title: twoWay.title,
      notes: twoWay.notes,
      dueDay: twoWay.plannedDate,
      dueWithTime: twoWay.plannedDate,
      deadlineDay: twoWay.deadline,
      deadlineWithTime: twoWay.deadline,
    };
  }

  async fetchIssue(issueId: string, cfg: CaldavCfg): Promise<Record<string, unknown>> {
    const issue = await firstValueFrom(this._caldavClientService.getById$(issueId, cfg));
    return issue as unknown as Record<string, unknown>;
  }

  async pushChanges(
    issueId: string,
    changes: Record<string, unknown>,
    cfg: CaldavCfg,
  ): Promise<void> {
    await firstValueFrom(
      this._caldavClientService.updateFields$(
        cfg,
        issueId,
        changes as CaldavFieldUpdates,
      ),
    );
  }

  extractSyncValues(issue: Record<string, unknown>): Record<string, unknown> {
    return {
      completed: issue['completed'],
      summary: issue['summary'],
      note: issue['note'],
      dtstart: toCaldavDateValue(
        issue['start'] as number | undefined,
        issue['isAllDay'] as boolean | undefined,
      ),
      due: toCaldavDateValue(
        issue['due'] as number | undefined,
        issue['isDueAllDay'] as boolean | undefined,
      ),
    };
  }

  getIssueLastUpdated(issue: Record<string, unknown>): number {
    return issue['etag_hash'] as number;
  }
}
