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
import {
  PropsStateSelector,
  SelectByIdFactory,
} from '../core/entity-registry-host.types';
import { ConflictJournalService } from './conflict-journal.service';
import { ConflictJournalEntry, ConflictJournalReason } from './conflict-journal.model';
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

/**
 * Reasons whose flip needs delete/restore semantics that a normal update op
 * cannot express: `delete-lost` would have to re-apply a delete, `delete-wins`
 * would have to resurrect a deleted entity. Both are DEFERRED — until then the
 * entry stays reviewable but flip is refused instead of falsely succeeding.
 */
const FLIP_UNSUPPORTED_REASONS: ReadonlySet<ConflictJournalReason> =
  new Set<ConflictJournalReason>(['delete-lost', 'delete-wins']);

/**
 * Fields a bare `{id,changes}` update cannot safely re-apply, in two classes:
 *
 * - RELATIONSHIP fields kept consistent across entities by meta-reducers
 *   (e.g. moving a task rewrites BOTH `task.projectId` and the project's
 *   `taskIds`) — re-applying one side of the pair would corrupt the other
 *   entity's membership list.
 * - SCHEDULE/REMINDER fields whose invariants live in dedicated flows, not the
 *   reducer: `dueDay`/`dueWithTime` mutual exclusivity, `dueDay`→TODAY_TAG
 *   membership, and reminder create/cancel tied to `reminderId`/`remindAt`/
 *   `deadlineRemindAt` (scheduled via `scheduleTaskWithTime`, torn down via
 *   `dismissReminderOnly`/`clearDeadlineReminder`) — a bare update can produce
 *   the both-set state or a dangling/missing reminder.
 *
 * Flips touching any of these are refused until domain-specific handling
 * exists (honest refusal over silent cross-entity corruption).
 *
 * NOTE: this is a deny-list — any Task field NOT listed here is flippable by
 * default. When adding a Task field with cross-entity or dedicated-flow
 * invariants, add it here too; the spec's per-field `canFlip() is false when
 * the discarded side touched <field>` cases pin the reminder/schedule members
 * against silent drift.
 */
const FLIP_UNSAFE_FIELDS: ReadonlySet<string> = new Set<string>([
  'projectId',
  'parentId',
  'subTaskIds',
  'tagIds',
  'taskIds',
  'backlogTaskIds',
  'noteIds',
  'dueDay',
  'dueWithTime',
  'deadlineDay',
  'deadlineWithTime',
  'reminderId',
  // Reminder-lifecycle timestamps: setting them via a bare update writes the
  // field without scheduling/cancelling the actual reminder in ReminderService.
  'remindAt',
  'deadlineRemindAt',
]);

@Injectable({ providedIn: 'root' })
export class SyncConflictUiService {
  private readonly _store = inject(Store);
  private readonly _journal = inject(ConflictJournalService);
  private readonly _snack = inject(SnackService);
  private readonly _matDialog = inject(MatDialog);

  /**
   * Whether FLIP can be applied for this entry. Requires a supported entity
   * type, a reason expressible as a normal update op (not delete/restore), and
   * at least one discarded field value that is safe to re-apply (relationship
   * and schedule/reminder fields are excluded — see FLIP_UNSAFE_FIELDS).
   */
  canFlip(entry: ConflictJournalEntry): boolean {
    if (!FLIP_SUPPORTED_TYPES.has(entry.entityType)) {
      return false;
    }
    if (FLIP_UNSUPPORTED_REASONS.has(entry.reason)) {
      return false;
    }
    const fields = Object.keys(loserChangesFor(entry));
    return fields.length > 0 && !fields.some((field) => FLIP_UNSAFE_FIELDS.has(field));
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
    if (!this.canFlip(entry)) {
      this._snack.open({ msg: CR.FLIP_UNSUPPORTED, type: 'ERROR' });
      return 'unsupported';
    }
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

    // canFlip guarantees non-empty changes, so the op is always dispatched —
    // an entry is only ever marked flipped when something was actually applied.
    this._store.dispatch(action);
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
   * targets local-won entries. Merged entries are never touched.
   *
   * Stale entries are SKIPPED (left unreviewed), never silently flipped: a bulk
   * action must not overwrite an edit made after the conflict resolved. Because
   * the bulk path shows no per-entry dialog, we cannot ask — so we refuse the
   * risky ones and leave them for per-entry flip (which surfaces the confirm).
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
        const { isStale } = await this.getStaleState(entry);
        if (isStale) {
          continue;
        }
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
    // A field the WINNER changed diverged from its kept value → entity edited
    // since resolution.
    const winnerVals = winnerChangesFor(entry);
    const winnerStale = Object.keys(winnerVals).some(
      (field) => !this._valueEquals(current[field], winnerVals[field]),
    );
    // Loser-only fields: FLIP WILL write these, but the winner never changed
    // them, so `winnerChangesFor` cannot see them — leaving getStaleState blind
    // to exactly the fields flip overwrites. We can only tell "edited since" from
    // "clean" when the loser's value actually PERSISTED in current state, and
    // that is ONLY when the loser is the LOCAL side (`winner === 'remote'`): a
    // remote win rejects the local op in the log but does NOT roll local state
    // back, so the loser's optimistic value stays applied — a clean entry has
    // `current === flipVal`, and any divergence is a genuine post-resolution edit
    // flip would silently overwrite. For a LOCAL win the loser is REMOTE, whose
    // value was never applied (current holds the un-recorded base), so
    // `current !== flipVal` is the NORMAL post-resolution state, not an edit — we
    // have no baseline to compare against and must NOT flag it stale (doing so
    // false-positives on the common two-device shape and silently skips valid
    // bulk flips). Detecting that quadrant needs a journaled post-resolution
    // baseline (follow-up).
    const flipVals = entry.winner === 'remote' ? loserChangesFor(entry) : {};
    const loserOnlyStale = Object.keys(flipVals).some(
      (field) =>
        !(field in winnerVals) && !this._valueEquals(current[field], flipVals[field]),
    );
    return { isStale: winnerStale || loserOnlyStale, current };
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
          // A flipped title is a journaled LITERAL value, not user input: without
          // this, a title-only flip matches shortSyntax$'s exact trigger shape and
          // any `#tag`/`+project`/`@schedule` tokens in the discarded title would
          // re-parse into cross-entity tag/project/schedule mutations.
          isIgnoreShortSyntax: true,
        });
      case 'PROJECT':
        return updateProject({
          project: {
            id: entityId,
            changes: changes as Partial<Project>,
          } as Update<Project>,
          // The flip flow reports its own outcome — without this the
          // unconditional "Project updated" snack pops on top of it.
          isSkipSnack: true,
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
    try {
      // ISSUE_PROVIDER registers a `(id, key) => selector` FACTORY, not a props
      // selector (mirrors ConflictResolutionService.getCurrentEntityState).
      // Calling it as a props selector would return the inner selector FUNCTION
      // as the "entity" and render a bogus current column + stale flag.
      if (entityType === 'ISSUE_PROVIDER') {
        const factory = config.selectById as SelectByIdFactory<null>;
        const entity = await firstValueFrom(this._store.select(factory(entityId, null)));
        return (entity as Record<string, unknown> | undefined) ?? undefined;
      }
      // `SelectById` is a union across the registry's selector shapes; every
      // other adapter type registers the standard props-based selector, so
      // narrowing to that union member is safe here.
      const selectById = config.selectById as PropsStateSelector<{ id: string }>;
      const entity = await firstValueFrom(
        this._store.select(selectById, { id: entityId }),
      );
      return (entity as Record<string, unknown> | undefined) ?? undefined;
    } catch {
      // Some selectors (selectTagById, selectNoteById) THROW on a missing
      // entity instead of returning undefined — the app-wide convention. For
      // this read-only "current state" lookup both mean the same thing.
      return undefined;
    }
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
