/**
 * SPAP-15 — Orchestration for the Sync Conflicts review UI.
 *
 * KEEP just confirms the auto-resolution (`markKept`). FLIP re-applies the
 * *discarded* (losing) side of the conflict by dispatching a NORMAL entity
 * update action — the exact same action a manual edit dispatches — so the
 * `operationCaptureMetaReducer` turns it into a synced op that propagates to
 * every device. There is NO history rewind: flipping is a brand-new edit layered
 * on top of the current state.
 *
 * Stale-flip guard: before applying, the entity's CURRENT field values are
 * compared to the journaled WINNER values. If they differ, the entity was edited
 * after the conflict resolved, so flipping would overwrite that newer edit — the
 * user is asked to confirm first.
 */

import { inject, Injectable } from '@angular/core';
import { Action, Store } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { EntityType } from '../core/operation.types';
import { getEntityConfig, isAdapterEntity } from '../core/entity-registry';
import { ConflictJournalService } from './conflict-journal.service';
import { ConflictJournalEntry } from './conflict-journal.model';
import { loserChangesFor, winnerChangesFor } from './sync-conflict-review.util';
import { SnackService } from '../../core/snack/snack.service';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { T } from '../../t.const';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { updateProject } from '../../features/project/store/project.actions';
import { updateNote } from '../../features/note/store/note.actions';
import { updateTag } from '../../features/tag/store/tag.actions';
import { Task } from '../../features/tasks/task.model';
import { Project } from '../../features/project/project.model';
import { Note } from '../../features/note/note.model';
import { Tag } from '../../features/tag/tag.model';

const CR = T.F.SYNC.CONFLICT_REVIEW;

export type FlipResult = 'applied' | 'cancelled' | 'unsupported';

export interface StaleState {
  isStale: boolean;
  current: Record<string, unknown> | undefined;
}

/** Entity types whose flip is implemented via a normal `{id,changes}` update. */
const FLIP_SUPPORTED_TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
  'TASK',
  'PROJECT',
  'NOTE',
  'TAG',
]);

@Injectable({ providedIn: 'root' })
export class SyncConflictUiService {
  private readonly _store = inject(Store);
  private readonly _journal = inject(ConflictJournalService);
  private readonly _snack = inject(SnackService);
  private readonly _matDialog = inject(MatDialog);

  /** Whether FLIP can be applied for this entry's entity type. */
  canFlip(entry: ConflictJournalEntry): boolean {
    return FLIP_SUPPORTED_TYPES.has(entry.entityType);
  }

  /** KEEP — confirm the auto-resolution. */
  async keep(entry: ConflictJournalEntry): Promise<void> {
    await this._journal.markKept(entry.id);
  }

  /**
   * FLIP — dispatch a normal update op that re-applies the loser's journaled
   * field values, then mark the entry flipped. Returns what happened so the
   * caller can surface it / refresh the list.
   */
  async flip(
    entry: ConflictJournalEntry,
    opts: { skipStaleConfirm?: boolean } = {},
  ): Promise<FlipResult> {
    const changes = loserChangesFor(entry);
    const action = this._buildUpdateAction(entry.entityType, entry.entityId, changes);
    if (!action) {
      this._snack.open({ msg: CR.FLIP_UNSUPPORTED, type: 'ERROR' });
      return 'unsupported';
    }

    const { isStale, current } = await this.getStaleState(entry);
    if (!current) {
      // The entity is not in the live store — it was deleted (delete-wins) or
      // archived out of the adapter. A normal update op can't recreate it, so
      // rather than silently marking the entry "flipped" we report unsupported.
      // Deletion-restore / archived-entity flips are DEFERRED (see report).
      this._snack.open({ msg: CR.FLIP_UNSUPPORTED, type: 'ERROR' });
      return 'unsupported';
    }

    if (!opts.skipStaleConfirm && isStale) {
      const confirmed = await this._confirmStaleFlip(entry);
      if (!confirmed) {
        return 'cancelled';
      }
    }

    // Empty changes (nothing was actually discarded) → skip the op but still
    // record the user's decision so the entry leaves the unreviewed list.
    if (Object.keys(changes).length > 0) {
      this._store.dispatch(action);
    }
    await this._journal.markFlipped(entry.id);
    return 'applied';
  }

  /** Bulk KEEP — confirm every still-unreviewed entry. */
  async keepAll(entries: readonly ConflictJournalEntry[]): Promise<void> {
    for (const entry of entries) {
      if (entry.status === 'unreviewed') {
        await this._journal.markKept(entry.id);
      }
    }
  }

  /**
   * Bulk FLIP toward one side: applies to rows where that side LOST (so flipping
   * makes it win). `side='local'` targets remote-won entries; `side='remote'`
   * targets local-won entries. Merged entries are never touched. The per-entry
   * stale confirm is skipped for the bulk path (explicit power action).
   */
  async flipAllToSide(
    entries: readonly ConflictJournalEntry[],
    side: 'local' | 'remote',
  ): Promise<void> {
    const loserIsSide = side === 'local' ? 'remote' : 'local';
    for (const entry of entries) {
      if (
        entry.status === 'unreviewed' &&
        entry.winner === loserIsSide &&
        this.canFlip(entry)
      ) {
        await this.flip(entry, { skipStaleConfirm: true });
      }
    }
  }

  /**
   * Reads the entity's CURRENT state and reports whether it diverged from the
   * journaled winner values (i.e. was edited after the conflict resolved). Used
   * both by the flip guard and by the page to surface a "current" column.
   */
  async getStaleState(entry: ConflictJournalEntry): Promise<StaleState> {
    const current = await this._readCurrentEntity(entry.entityType, entry.entityId);
    if (!current) {
      return { isStale: false, current: undefined };
    }
    const winnerVals = winnerChangesFor(entry);
    const isStale = Object.keys(winnerVals).some(
      (field) => !this._valueEquals(current[field], winnerVals[field]),
    );
    return { isStale, current };
  }

  private _buildUpdateAction(
    entityType: EntityType,
    entityId: string,
    changes: Record<string, unknown>,
  ): Action | undefined {
    switch (entityType) {
      case 'TASK':
        return TaskSharedActions.updateTask({
          task: { id: entityId, changes: changes as Partial<Task> } as Update<Task>,
        });
      case 'PROJECT':
        return updateProject({
          project: {
            id: entityId,
            changes: changes as Partial<Project>,
          } as Update<Project>,
        });
      case 'NOTE':
        return updateNote({
          note: { id: entityId, changes: changes as Partial<Note> } as Update<Note>,
        });
      case 'TAG':
        return updateTag({
          tag: { id: entityId, changes: changes as Partial<Tag> } as Update<Tag>,
          isSkipSnack: true,
        });
      default:
        return undefined;
    }
  }

  private async _readCurrentEntity(
    entityType: EntityType,
    entityId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const config = getEntityConfig(entityType);
    if (!config || !isAdapterEntity(config) || !config.selectById) {
      return undefined;
    }
    // Only the standard props-based `selectById` shape is used here; the flip-
    // supported types (TASK/PROJECT/NOTE/TAG) all use it. The `as any` mirrors
    // ConflictResolutionService.getCurrentEntityState — EntityConfig.selectById
    // is a union NgRx cannot narrow to a props selector (known typing limit).
    const entity = await firstValueFrom(
      this._store.select(config.selectById as any, { id: entityId }),
    );
    return (entity as Record<string, unknown> | undefined) ?? undefined;
  }

  private _valueEquals(a: unknown, b: unknown): boolean {
    if (a === b) {
      return true;
    }
    // Structural fallback for arrays/objects captured verbatim from op payloads.
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  private async _confirmStaleFlip(entry: ConflictJournalEntry): Promise<boolean> {
    const res = await firstValueFrom(
      this._matDialog
        .open(DialogConfirmComponent, {
          restoreFocus: true,
          data: {
            message: CR.STALE_CONFIRM,
            translateParams: { title: entry.entityTitle },
          },
        })
        .afterClosed(),
    );
    return res === true;
  }
}
