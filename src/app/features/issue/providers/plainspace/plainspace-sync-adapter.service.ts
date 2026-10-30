import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { IssueSyncAdapter } from '../../two-way-sync/issue-sync-adapter.interface';
import {
  FieldMapping,
  FieldSyncConfig,
  IssueSyncPushError,
} from '../../two-way-sync/issue-sync.model';
import { T } from '../../../../t.const';
import { PlainspaceCfg } from './plainspace.model';
import { PlainspaceApiService, PlainspaceTaskPatch } from './plainspace-api.service';
import { PlainspaceConnectionStateService } from './plainspace-connection-state.service';

/** Plainspace's item text limit (`MAX_ITEM_TEXT_LENGTH`), in UTF-16 units. */
export const PLAINSPACE_MAX_TITLE_LENGTH = 500;

/**
 * Field mappings between Super Productivity and Plainspace:
 * - `isDone` → `done`
 * - `title` → `title`
 * - `dueWithTime` → `scheduledAt`
 *
 * - `dueDay` → `scheduledAt` (push only: a plan without a time)
 *
 * All sync both ways. Plainspace has one schedule field, a time, so the value
 * sent is the task's `dueWithTime`, or "no time" when it has none: a day-only
 * plan, adding to Today without a time and unscheduling all clear it (plan
 * § Scheduled time). `dueDay` maps onto the same remote field and always sends
 * "no time"; it only decides when a change reports the day alone (planning a
 * day), since `dueWithTime` comes first and the engine decides a remote field
 * once.
 */
const PLAINSPACE_FIELD_MAPPINGS: FieldMapping[] = [
  {
    taskField: 'isDone',
    issueField: 'isDone',
    defaultDirection: 'both',
    toIssueValue: (taskValue: unknown): boolean => !!taskValue,
    toTaskValue: (issueValue: unknown): boolean => !!issueValue,
  },
  {
    taskField: 'title',
    issueField: 'title',
    defaultDirection: 'both',
    toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
    toTaskValue: (issueValue: unknown): string => (issueValue as string) ?? '',
  },
  {
    taskField: 'dueWithTime',
    issueField: 'scheduledAt',
    defaultDirection: 'both',
    toIssueValue: (taskValue: unknown): string | null =>
      typeof taskValue === 'number' ? new Date(taskValue).toISOString() : null,
    // "No time" is null, not undefined: JSON drops an undefined from the op, so
    // other devices kept the old time (#9776). `Task.dueWithTime` allows null,
    // so released clients apply it as a clear.
    toTaskValue: (issueValue: unknown): number | null =>
      typeof issueValue === 'string' ? new Date(issueValue).getTime() : null,
  },
  {
    taskField: 'dueDay',
    issueField: 'scheduledAt',
    defaultDirection: 'pushOnly',
    toIssueValue: (): null => null,
    toTaskValue: (): undefined => undefined,
  },
];

/**
 * Two-way sync adapter for Plainspace: writes completion, title and the
 * scheduled time back. A repeating item's time is Plainspace's (pull only).
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceSyncAdapterService implements IssueSyncAdapter<PlainspaceCfg> {
  private readonly _api = inject(PlainspaceApiService);
  private readonly _connectionState = inject(PlainspaceConnectionStateService);

  getFieldMappings(): FieldMapping[] {
    return PLAINSPACE_FIELD_MAPPINGS;
  }

  getSyncConfig(cfg: PlainspaceCfg, issue?: Record<string, unknown>): FieldSyncConfig {
    // A server too old for titles and times keeps both pull-only for the
    // session. A repeating item's time is set in Plainspace: local edits stay
    // until the next occurrence moves it.
    const providerId = getProviderId(cfg);
    const isServerTooOld =
      !!providerId && this._connectionState.isServerTooOld(providerId);
    const isTimePullOnly = isServerTooOld || issue?.['isRecurring'] === true;
    return {
      isDone: 'both',
      title: isServerTooOld ? 'pullOnly' : 'both',
      dueWithTime: isTimePullOnly ? 'pullOnly' : 'both',
      dueDay: isTimePullOnly ? 'off' : 'pushOnly',
    };
  }

  /**
   * Creates the task in Plainspace when it is first added to a Plainspace-backed
   * project (via the generic `autoCreateIssueOnTaskAdd$` effect), then hands the
   * created issue back so the effect can link it and seed the two-way-sync
   * baseline. No `issueNumber`: Plainspace tasks have no numeric id, so the SP
   * title stays as typed (no `#123` prefix).
   */
  async createIssue(
    title: string,
    cfg: PlainspaceCfg,
  ): Promise<{ issueId: string; issueData: Record<string, unknown> }> {
    const issue = await firstValueFrom(this._api.createTask$(title, cfg));
    return {
      issueId: issue.id,
      issueData: issue as Record<string, unknown>,
    };
  }

  /**
   * Deletes the task in Plainspace when its SP task is deleted (via the generic
   * `deleteIssueOnTaskDelete$` effects, after the undo window). Without this the
   * next poll re-imports the still-assigned task, so it can never be deleted.
   */
  async deleteIssue(issueId: string, cfg: PlainspaceCfg): Promise<void> {
    await firstValueFrom(this._api.deleteTask$(issueId, cfg));
  }

  async fetchIssue(
    issueId: string,
    cfg: PlainspaceCfg,
  ): Promise<Record<string, unknown>> {
    try {
      const issue = await firstValueFrom(this._api.getById$(issueId, cfg));
      return (issue ?? {}) as unknown as Record<string, unknown>;
    } catch (err) {
      this._reportError(cfg, err);
      throw err;
    }
  }

  /**
   * PATCHes completion, title and scheduled time. The server stores the title
   * verbatim and the time as an instant, so the echo must match exactly. A
   * server from before titles and times were accepted answers a request
   * carrying one with a 422 (no `done` next to it) or ignores it (200 with the
   * old value): neither is pushed to that provider again this session, done is
   * sent on its own, and the rejection is an expected skip, so baselines stay
   * put and the next poll reconciles. A 409 is a refusal of this change (e.g.
   * the item became repeating), never an old server.
   */
  async pushChanges(
    issueId: string,
    changes: Record<string, unknown>,
    cfg: PlainspaceCfg,
  ): Promise<void | Record<string, unknown>> {
    const patch: PlainspaceTaskPatch = {};
    if ('isDone' in changes) {
      patch.done = !!changes['isDone'];
    }
    // A title Plainspace can't take is not sent; the rest still is, then the
    // task shows why its title didn't sync.
    const titleErrorKey = 'title' in changes ? invalidTitleKey(changes['title']) : null;
    if ('title' in changes && !titleErrorKey) {
      patch.title = changes['title'] as string;
    }
    if ('scheduledAt' in changes) {
      patch.scheduledAt = (changes['scheduledAt'] as string | null) ?? null;
    }
    if (
      patch.done === undefined &&
      patch.title === undefined &&
      patch.scheduledAt === undefined
    ) {
      if (titleErrorKey) {
        throw new IssueSyncPushError(titleErrorKey);
      }
      return;
    }

    let updated;
    try {
      updated = await firstValueFrom(this._api.patchTask$(issueId, patch, cfg));
    } catch (err) {
      const status = httpStatus(err);
      if (status === 422 && hasNewField(patch)) {
        return this._onServerTooOld(issueId, patch, cfg);
      }
      if (status === 409) {
        throw new IssueSyncPushError(
          conflictError(err) === 'repeat_requires_remind_at'
            ? T.PLAINSPACE.SYNC.ERR_REPEAT_NEEDS_TIME
            : T.PLAINSPACE.SYNC.ERR_REFUSED,
        );
      }
      this._reportError(cfg, err);
      throw err;
    }
    assertEchoed(issueId, patch.done, updated);
    if (
      (patch.title !== undefined && updated?.title !== patch.title) ||
      (patch.scheduledAt !== undefined &&
        !isSameInstant(updated?.scheduledAt, patch.scheduledAt))
    ) {
      return this._onServerTooOld(issueId, { done: patch.done }, cfg, true);
    }
    if (titleErrorKey) {
      // The rest was written, but baselines only move with a full success:
      // the next poll sees the remote change and pulls the same value.
      throw new IssueSyncPushError(titleErrorKey);
    }
    // The row as written: its updatedAt is the marker of our own write. A
    // re-fetch could already carry a later change by someone else.
    return updated?.updatedAt ? { updatedAt: updated.updatedAt } : undefined;
  }

  /** A rejected token shows "reconnect" now, not only after the next poll. */
  private _reportError(cfg: PlainspaceCfg, err: unknown): void {
    const providerId = getProviderId(cfg);
    if (providerId) {
      this._connectionState.reportError(providerId, err, cfg.token);
    }
  }

  private async _onServerTooOld(
    issueId: string,
    patch: PlainspaceTaskPatch,
    cfg: PlainspaceCfg,
    isDoneApplied = false,
  ): Promise<never> {
    const providerId = getProviderId(cfg);
    if (providerId) {
      this._connectionState.reportServerTooOld(providerId);
    }
    if (patch.done !== undefined && !isDoneApplied) {
      const updated = await firstValueFrom(
        this._api.patchTask$(issueId, { done: patch.done }, cfg),
      );
      assertEchoed(issueId, patch.done, updated);
    }
    throw { isExpectedSyncSkip: true, reason: 'plainspace-server-too-old' };
  }

  extractSyncValues(issue: Record<string, unknown>): Record<string, unknown> {
    // Completion needs a push baseline; title and schedule remain in the same
    // remote baseline so polling can identify provider-owned changes.
    return {
      isDone: issue['isDone'],
      title: issue['title'],
      scheduledAt: issue['scheduledAt'],
    };
  }

  getIssueLastUpdated(issue: Record<string, unknown>): number {
    const updatedAt = issue['updatedAt'];
    return updatedAt ? new Date(updatedAt as string).getTime() : 0;
  }
}

const getProviderId = (cfg: PlainspaceCfg): string | undefined =>
  (cfg as { id?: string }).id;

const httpStatus = (err: unknown): number | undefined =>
  err instanceof HttpErrorResponse ? err.status : undefined;

/** The `error` code of a 409 answer, e.g. `repeat_requires_remind_at`. */
const conflictError = (err: unknown): unknown =>
  err instanceof HttpErrorResponse
    ? (err.error as { error?: unknown })?.error
    : undefined;

/** Fields an older server neither takes nor reports back. */
const hasNewField = (patch: PlainspaceTaskPatch): boolean =>
  patch.title !== undefined || patch.scheduledAt !== undefined;

/** The server answers times as UTC ISO, whatever offset was sent. */
const isSameInstant = (a: unknown, b: string | null): boolean =>
  b === null ? a === null : typeof a === 'string' && Date.parse(a) === Date.parse(b);

/**
 * Why Plainspace would refuse this title, or null: it takes 1–500 characters
 * and refuses a blank title.
 */
const invalidTitleKey = (title: unknown): string | null => {
  if (typeof title !== 'string' || !title.trim()) {
    return T.PLAINSPACE.SYNC.ERR_TITLE_EMPTY;
  }
  if (title.length > PLAINSPACE_MAX_TITLE_LENGTH) {
    return T.PLAINSPACE.SYNC.ERR_TITLE_TOO_LONG;
  }
  return null;
};

const assertEchoed = (
  issueId: string,
  done: boolean | undefined,
  updated: { id: string; isDone: boolean } | null,
): void => {
  if (
    !updated ||
    updated.id !== issueId ||
    (done !== undefined && updated.isDone !== done)
  ) {
    throw new Error('Plainspace update failed');
  }
};
