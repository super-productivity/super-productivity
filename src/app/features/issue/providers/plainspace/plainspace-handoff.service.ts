import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Task } from '../../../tasks/task.model';
import { IssueProviderService } from '../../issue-provider.service';
import { IssueSyncStateService } from '../../two-way-sync/issue-sync-state.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { Log } from '../../../../core/log';
import { T } from '../../../../t.const';
import { PlainspaceApiService, PlainspaceMember } from './plainspace-api.service';
import { PlainspaceCfg } from './plainspace.model';

/**
 * Hands a linked task assigned to me to another member of its space, or
 * releases it to the space (task context menu). Afterwards the task is no
 * longer mine and behaves like one reassigned in Plainspace: it shows "no
 * longer in your Plainspace list" and stops syncing until a poll returns it
 * again. Nothing local changes, so a handoff writes no op.
 *
 * Older servers answer the members request with 404 and an `assigneeId`-only
 * PATCH with 422; both show "server too old" (no capability negotiation). The
 * PATCH carries `assigneeId` alone: an older server would apply the other
 * fields of a combined request and silently drop the assignee.
 *
 * Edits not pushed yet (e.g. a rename made while Plainspace was unreachable,
 * waiting for the next poll) are pushed first: once handed off the task stops
 * syncing, and they would never reach the Space. If that push fails, the task
 * is not handed off.
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceHandoffService {
  private _apiService = inject(PlainspaceApiService);
  private _issueProviderService = inject(IssueProviderService);
  private _syncState = inject(IssueSyncStateService);
  private _snackService = inject(SnackService);

  /** Who the task can be handed to, or null after a snack saying why not. */
  async getMembers(task: Task): Promise<PlainspaceMember[] | null> {
    try {
      const cfg = await this._getCfg(task);
      return await firstValueFrom(this._apiService.getSpaceMembers$(cfg));
    } catch (err) {
      this._snackError(err, 404);
      return null;
    }
  }

  /** Hands the task to `member`, or releases it to the space when null. */
  async handOff(task: Task, member: PlainspaceMember | null): Promise<void> {
    if (!(await this._syncState.pushPending(task.id))) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.PLAINSPACE.HANDOFF.UNSYNCED_EDITS,
      });
      return;
    }
    try {
      const cfg = await this._getCfg(task);
      await firstValueFrom(
        this._apiService.patchTask$(
          task.issueId as string,
          { assigneeId: member?.id ?? null },
          cfg,
        ),
      );
    } catch (err) {
      // A 404 says why in its body: the task is no longer mine (mark it as a
      // poll would), or the member left the space (the list reloads on open).
      const reason =
        err instanceof HttpErrorResponse && err.status === 404
          ? (err.error as { error?: unknown } | null)?.error
          : undefined;
      if (reason === 'Task not found') {
        this._syncState.setMissing([task.id], [task.id]);
        this._snackService.open({ type: 'ERROR', msg: T.PLAINSPACE.HANDOFF.NOT_YOURS });
      } else if (reason === 'Member not found') {
        this._snackService.open({ type: 'ERROR', msg: T.PLAINSPACE.HANDOFF.MEMBER_LEFT });
      } else {
        this._snackError(err, 422);
      }
      return;
    }
    this._syncState.setMissing([task.id], [task.id]);
    this._snackService.open(
      member
        ? {
            type: 'SUCCESS',
            msg: T.PLAINSPACE.HANDOFF.ASSIGNED,
            translateParams: { name: member.displayName },
          }
        : { type: 'SUCCESS', msg: T.PLAINSPACE.HANDOFF.RELEASED },
    );
  }

  private _getCfg(task: Task): Promise<PlainspaceCfg> {
    return firstValueFrom(
      this._issueProviderService.getCfgOnce$(
        task.issueProviderId as string,
        'PLAINSPACE',
      ),
    );
  }

  private _snackError(err: unknown, tooOldStatus: number): void {
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    Log.err('Plainspace: handoff failed', { status });
    this._snackService.open({
      type: 'ERROR',
      msg:
        status === tooOldStatus
          ? T.PLAINSPACE.HANDOFF.SERVER_TOO_OLD
          : T.PLAINSPACE.HANDOFF.FAILED,
    });
  }
}
