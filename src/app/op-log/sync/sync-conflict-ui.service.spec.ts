import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { SyncConflictUiService } from './sync-conflict-ui.service';
import { ConflictJournalService } from './conflict-journal.service';
import { ConflictJournalEntry } from './conflict-journal.model';
import { SnackService } from '../../core/snack/snack.service';
import { EntityType } from '../core/operation.types';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { selectTaskById } from '../../features/tasks/store/task.selectors';
import { selectProjectById } from '../../features/project/store/project.selectors';
import { updateProject } from '../../features/project/store/project.actions';
import { Project } from '../../features/project/project.model';
import { Task } from '../../features/tasks/task.model';

const makeEntry = (over: Partial<ConflictJournalEntry> = {}): ConflictJournalEntry => ({
  id: 'e1',
  entityType: 'TASK' as EntityType,
  entityId: 'task-1',
  entityTitle: 'Test Task',
  resolvedAt: 1000,
  winner: 'remote',
  reason: 'newer',
  fieldDiffs: [
    {
      field: 'title',
      localVal: 'Local title',
      remoteVal: 'Remote title',
      pickedSide: 'remote',
    },
  ],
  localClientId: 'A',
  remoteClientId: 'B',
  localTs: 1000,
  remoteTs: 2000,
  status: 'unreviewed',
  ...over,
});

describe('SyncConflictUiService', () => {
  let service: SyncConflictUiService;
  let journal: ConflictJournalService;
  let store: MockStore;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let dispatchSpy: jasmine.Spy;

  const setDialogResult = (res: boolean): void => {
    matDialog.open.and.returnValue({ afterClosed: () => of(res) } as never);
  };

  beforeEach(() => {
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    setDialogResult(true);

    TestBed.configureTestingModule({
      providers: [
        SyncConflictUiService,
        ConflictJournalService,
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        { provide: MatDialog, useValue: matDialog },
        provideMockStore({ initialState: {} }),
      ],
    });

    service = TestBed.inject(SyncConflictUiService);
    journal = TestBed.inject(ConflictJournalService);
    store = TestBed.inject(Store) as MockStore;
    // Not stale by default: current title equals the journaled winner value.
    store.overrideSelector(selectTaskById, {
      id: 'task-1',
      title: 'Remote title',
    } as Task);
    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
  });

  afterEach(() => {
    // overrideSelector mutates the SHARED selector references (selectTaskById /
    // selectProjectById) — without a reset the overrides leak into other spec
    // files in the same karma bundle (e.g. project.service.spec).
    store.resetSelectors();
  });

  it('keep() marks the entry kept', async () => {
    const entry = makeEntry();
    await journal.record(entry);
    await service.keep(entry);
    expect((await journal.getEntry('e1'))?.status).toBe('kept');
  });

  it('flip() dispatches a normal update op with the LOSER values and marks flipped', async () => {
    const entry = makeEntry();
    await journal.record(entry);

    const result = await service.flip(entry);

    expect(result).toBe('applied');
    expect(dispatchSpy).toHaveBeenCalledWith(
      TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { title: 'Local title' } },
        isIgnoreShortSyntax: true,
      }),
    );
    expect((await journal.getEntry('e1'))?.status).toBe('flipped');
  });

  it('flip() shows the stale confirm when the entity changed since resolution', async () => {
    const entry = makeEntry();
    await journal.record(entry);
    // Current title differs from the journaled winner ("Remote title") → stale.
    store.overrideSelector(selectTaskById, {
      id: 'task-1',
      title: 'Edited later',
    } as Task);
    store.refreshState();
    setDialogResult(true);

    const result = await service.flip(entry);

    expect(matDialog.open).toHaveBeenCalled();
    expect(result).toBe('applied');
    expect(dispatchSpy).toHaveBeenCalled();
  });

  it('flip() aborts (no dispatch) when the stale confirm is cancelled', async () => {
    const entry = makeEntry();
    await journal.record(entry);
    store.overrideSelector(selectTaskById, {
      id: 'task-1',
      title: 'Edited later',
    } as Task);
    store.refreshState();
    setDialogResult(false);

    const result = await service.flip(entry);

    expect(result).toBe('cancelled');
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect((await journal.getEntry('e1'))?.status).toBe('unreviewed');
  });

  it('getStaleState() flags stale when a LOSER-ONLY field was edited after resolution', async () => {
    // Overlapping-field LWW conflict: loser changed title+notes, winner changed
    // only title (remote won). `notes` is a loser-only field — winnerChangesFor
    // cannot see it, so the guard was blind to a post-resolution notes edit and
    // flip would silently overwrite it. getStaleState must now detect it.
    const entry = makeEntry({
      id: 'lo1',
      fieldDiffs: [
        {
          field: 'title',
          localVal: 'Local title',
          remoteVal: 'Remote title',
          localChanged: true,
          remoteChanged: true,
          pickedSide: 'remote',
        },
        {
          field: 'notes',
          localVal: 'Loser notes',
          remoteVal: undefined,
          localChanged: true,
          remoteChanged: false,
          pickedSide: 'remote',
        },
      ],
    });
    // Winner field (title) unchanged, but notes was edited to a value that is
    // neither the kept value nor what flip would write.
    store.overrideSelector(selectTaskById, {
      id: 'task-1',
      title: 'Remote title',
      notes: 'USER-EDIT',
    } as Task);
    store.refreshState();

    const stale = await service.getStaleState(entry);
    expect(stale.isStale).toBe(true);
  });

  it('flip() shows the stale confirm for a post-resolution loser-only edit (previously silent)', async () => {
    const entry = makeEntry({
      id: 'lo2',
      fieldDiffs: [
        {
          field: 'title',
          localVal: 'Local title',
          remoteVal: 'Remote title',
          localChanged: true,
          remoteChanged: true,
          pickedSide: 'remote',
        },
        {
          field: 'notes',
          localVal: 'Loser notes',
          remoteVal: undefined,
          localChanged: true,
          remoteChanged: false,
          pickedSide: 'remote',
        },
      ],
    });
    await journal.record(entry);
    store.overrideSelector(selectTaskById, {
      id: 'task-1',
      title: 'Remote title',
      notes: 'USER-EDIT',
    } as Task);
    store.refreshState();
    setDialogResult(false); // user cancels → flip must NOT silently overwrite

    const result = await service.flip(entry);

    expect(matDialog.open).toHaveBeenCalled();
    expect(result).toBe('cancelled');
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('flipAllToSide() skips stale entries (never silently overwrites in bulk)', async () => {
    // Remote-won entry whose loser-only notes field diverged after resolution.
    // Bulk flip-to-local must SKIP it (leave unreviewed), not silently overwrite
    // the newer notes — the bulk path shows no per-entry confirm.
    const entry = makeEntry({
      id: 'bulk1',
      winner: 'remote',
      fieldDiffs: [
        {
          field: 'title',
          localVal: 'Local title',
          remoteVal: 'Remote title',
          localChanged: true,
          remoteChanged: true,
          pickedSide: 'remote',
        },
        {
          field: 'notes',
          localVal: 'Loser notes',
          remoteVal: undefined,
          localChanged: true,
          remoteChanged: false,
          pickedSide: 'remote',
        },
      ],
    });
    await journal.record(entry);
    store.overrideSelector(selectTaskById, {
      id: 'task-1',
      title: 'Remote title',
      notes: 'USER-EDIT',
    } as Task);
    store.refreshState();

    await service.flipAllToSide([entry], 'local');

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect((await journal.getEntry('bulk1'))?.status).toBe('unreviewed');
  });

  it('getStaleState() does NOT false-positive on a LOCAL-won loser-only field (no post-edit)', async () => {
    // winner='local': the loser (remote) changed `notes`, which was rejected and
    // never applied, so current.notes sits at base — which legitimately differs
    // from the remote value flip would write. That is NOT a post-resolution edit,
    // so it must NOT be flagged stale (the loser-only check only applies when the
    // loser is LOCAL, i.e. winner='remote').
    const entry = makeEntry({
      id: 'lw1',
      winner: 'local',
      fieldDiffs: [
        {
          field: 'title',
          localVal: 'Local title',
          remoteVal: 'Remote title',
          localChanged: true,
          remoteChanged: true,
          pickedSide: 'local',
        },
        {
          field: 'notes',
          localVal: undefined,
          remoteVal: 'Remote notes',
          localChanged: false,
          remoteChanged: true,
          pickedSide: 'local',
        },
      ],
    });
    store.overrideSelector(selectTaskById, {
      id: 'task-1',
      title: 'Local title',
      notes: 'base notes',
    } as Task);
    store.refreshState();

    const stale = await service.getStaleState(entry);
    expect(stale.isStale).toBe(false);
  });

  it('flipAllToSide() flips a clean LOCAL-won entry (not falsely skipped as stale)', async () => {
    const entry = makeEntry({
      id: 'lw2',
      winner: 'local',
      fieldDiffs: [
        {
          field: 'title',
          localVal: 'Local title',
          remoteVal: 'Remote title',
          localChanged: true,
          remoteChanged: true,
          pickedSide: 'local',
        },
        {
          field: 'notes',
          localVal: undefined,
          remoteVal: 'Remote notes',
          localChanged: false,
          remoteChanged: true,
          pickedSide: 'local',
        },
      ],
    });
    await journal.record(entry);
    store.overrideSelector(selectTaskById, {
      id: 'task-1',
      title: 'Local title',
      notes: 'base notes',
    } as Task);
    store.refreshState();

    // flip-to-remote targets local-won entries; a clean one must actually flip.
    await service.flipAllToSide([entry], 'remote');

    expect(dispatchSpy).toHaveBeenCalled();
    expect((await journal.getEntry('lw2'))?.status).toBe('flipped');
  });

  it('flip() suppresses short-syntax parsing on the re-applied title', async () => {
    // The canonical flip is a rename conflict → changes is exactly { title },
    // which is precisely the shape shortSyntax$ re-parses in replace mode. A
    // journaled title like "Fix bug #urgent" must be re-applied LITERALLY, not
    // re-parsed into tag/project/schedule mutations.
    const entry = makeEntry({ id: 'ss1' });
    await journal.record(entry);

    const result = await service.flip(entry);

    expect(result).toBe('applied');
    const dispatched = dispatchSpy.calls.mostRecent().args[0] as ReturnType<
      typeof TaskSharedActions.updateTask
    >;
    expect(dispatched.isIgnoreShortSyntax).toBe(true);
  });

  it('flip() only dispatches fields the losing side actually changed', async () => {
    // local (loser) changed only title; remote (winner) also changed notes.
    // The dispatched changes must NOT contain notes: undefined — that would
    // clear the winner-only field instead of layering the discarded edit.
    const entry = makeEntry({
      id: 'presence1',
      fieldDiffs: [
        {
          field: 'title',
          localVal: 'Local title',
          remoteVal: 'Remote title',
          localChanged: true,
          remoteChanged: true,
          pickedSide: 'remote',
        },
        {
          field: 'notes',
          localVal: undefined,
          remoteVal: 'Remote notes',
          localChanged: false,
          remoteChanged: true,
          pickedSide: 'remote',
        },
      ],
    });
    await journal.record(entry);

    const result = await service.flip(entry);

    expect(result).toBe('applied');
    const dispatched = dispatchSpy.calls.mostRecent().args[0] as ReturnType<
      typeof TaskSharedActions.updateTask
    >;
    const changes = dispatched.task.changes as Record<string, unknown>;
    expect(changes).toEqual({ title: 'Local title' });
    expect(Object.prototype.hasOwnProperty.call(changes, 'notes')).toBe(false);
  });

  it('flip() on a PROJECT entry suppresses the "Project updated" snack (isSkipSnack)', async () => {
    // The flip already reports its own outcome; without isSkipSnack the
    // unconditional snackUpdateBaseSettings$ effect would ALSO pop
    // "Project updated" on top of it.
    const entry = makeEntry({
      id: 'p1',
      entityType: 'PROJECT' as EntityType,
      entityId: 'project-1',
    });
    await journal.record(entry);
    store.overrideSelector(selectProjectById, {
      id: 'project-1',
      title: 'Remote title',
    } as Project);
    store.refreshState();

    const result = await service.flip(entry);

    expect(result).toBe('applied');
    const dispatched = dispatchSpy.calls.mostRecent().args[0] as ReturnType<
      typeof updateProject
    >;
    expect(dispatched.type).toBe(updateProject.type);
    expect(dispatched.project).toEqual({
      id: 'project-1',
      changes: { title: 'Local title' },
    });
    expect((dispatched as { isSkipSnack?: boolean }).isSkipSnack).toBe(true);
  });

  it('canFlip() is false for delete-lost and delete-wins entries', () => {
    expect(service.canFlip(makeEntry({ reason: 'delete-lost', fieldDiffs: [] }))).toBe(
      false,
    );
    expect(service.canFlip(makeEntry({ reason: 'delete-wins' }))).toBe(false);
  });

  it('flip() reports unsupported for delete-lost (no false success)', async () => {
    // delete-lost: the entity was resurrected, fieldDiffs is empty. A normal
    // update op cannot re-apply the delete, so flip must NOT mark the entry
    // flipped / return applied while dispatching nothing.
    const entry = makeEntry({ id: 'dl1', reason: 'delete-lost', fieldDiffs: [] });
    await journal.record(entry);

    const result = await service.flip(entry);

    expect(result).toBe('unsupported');
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect((await journal.getEntry('dl1'))?.status).toBe('unreviewed');
  });

  it('flip() reports unsupported when the entry has no discarded field values', async () => {
    const entry = makeEntry({ id: 'empty1', fieldDiffs: [] });
    await journal.record(entry);

    const result = await service.flip(entry);

    expect(result).toBe('unsupported');
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect((await journal.getEntry('empty1'))?.status).toBe('unreviewed');
  });

  it('canFlip() is false when the discarded side touched relationship fields', () => {
    const entry = makeEntry({
      fieldDiffs: [
        {
          field: 'projectId',
          localVal: 'project-A',
          remoteVal: 'project-B',
          pickedSide: 'remote',
        },
      ],
    });
    expect(service.canFlip(entry)).toBe(false);
  });

  it('flip() reports unsupported when loser changes include relationship fields', async () => {
    // Re-applying projectId/subTaskIds/... via a bare adapter update bypasses
    // the multi-entity meta-reducer invariants (membership lists on the other
    // entity are not updated), so such flips must be refused, not dispatched.
    const entry = makeEntry({
      id: 'rel1',
      fieldDiffs: [
        {
          field: 'title',
          localVal: 'Local title',
          remoteVal: 'Remote title',
          pickedSide: 'remote',
        },
        {
          field: 'projectId',
          localVal: 'project-A',
          remoteVal: 'project-B',
          pickedSide: 'remote',
        },
      ],
    });
    await journal.record(entry);

    const result = await service.flip(entry);

    expect(result).toBe('unsupported');
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect((await journal.getEntry('rel1'))?.status).toBe('unreviewed');
  });

  it('canFlip() is false when the discarded side touched schedule/reminder fields', () => {
    // dueDay/dueWithTime/deadline*/reminderId invariants (mutual exclusivity,
    // TODAY_TAG membership, reminder create/cancel) are maintained by dedicated
    // flows, not by a bare updateTask — same honest-refusal policy as
    // relationship fields.
    const entry = makeEntry({
      fieldDiffs: [
        {
          field: 'dueWithTime',
          localVal: 111,
          remoteVal: 222,
          localChanged: true,
          remoteChanged: true,
          pickedSide: 'remote',
        },
      ],
    });
    expect(service.canFlip(entry)).toBe(false);
  });

  // Drift guard: every reminder/schedule field whose invariants live in a
  // dedicated flow must be refused by canFlip. Adding such a Task field without
  // adding it to FLIP_UNSAFE_FIELDS (a deny-list — unlisted fields are flippable
  // by default) would let a bare updateTask flip write the field WITHOUT
  // scheduling/cancelling the reminder or enforcing due/deadline exclusivity.
  (['remindAt', 'deadlineRemindAt', 'dueDay', 'deadlineWithTime'] as const).forEach(
    (field) => {
      it(`canFlip() is false when the discarded side touched ${field}`, () => {
        const entry = makeEntry({
          fieldDiffs: [
            {
              field,
              localVal: 111,
              remoteVal: 222,
              localChanged: true,
              remoteChanged: true,
              pickedSide: 'remote',
            },
          ],
        });
        expect(service.canFlip(entry)).toBe(false);
      });
    },
  );

  it('getStaleState() returns no current entity for factory-selector types (ISSUE_PROVIDER)', async () => {
    // ISSUE_PROVIDER registers a (id, key) => selector FACTORY, not a props
    // selector. Calling it as a props selector returns the inner selector
    // FUNCTION as the "entity", rendering a bogus current column + stale flag.
    const entry = makeEntry({
      id: 'ip1',
      entityType: 'ISSUE_PROVIDER' as EntityType,
      entityId: 'provider-1',
    });

    const stale = await service.getStaleState(entry);

    expect(stale.current).toBeUndefined();
    expect(stale.isStale).toBe(false);
  });

  it('getStaleState() resolves (no rejection) when the entity selector throws', async () => {
    // selectTagById / selectNoteById THROW on a missing entity (unlike
    // TASK/PROJECT which return undefined). Every delete-wins TAG/NOTE entry
    // hits this on row expand — it must resolve to "no current entity", not
    // reject through toggleExpand as an unhandled rejection.
    const entry = makeEntry({
      id: 'throw1',
      entityType: 'TAG' as EntityType,
      entityId: 'tag-gone',
    });

    const stale = await service.getStaleState(entry);

    expect(stale.current).toBeUndefined();
    expect(stale.isStale).toBe(false);
  });

  it('flip() reports unsupported (no rejection) when the entity selector throws', async () => {
    const entry = makeEntry({
      id: 'throw2',
      entityType: 'TAG' as EntityType,
      entityId: 'tag-gone',
    });
    await journal.record(entry);

    const result = await service.flip(entry);

    expect(result).toBe('unsupported');
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect((await journal.getEntry('throw2'))?.status).toBe('unreviewed');
  });

  it('flip() reports unsupported for a non-adapter entity type', async () => {
    const entry = makeEntry({ id: 'e2', entityType: 'GLOBAL_CONFIG' as EntityType });
    await journal.record(entry);

    const result = await service.flip(entry);

    expect(result).toBe('unsupported');
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect((await journal.getEntry('e2'))?.status).toBe('unreviewed');
  });

  it('flipAllToSide("local") only flips remote-won rows', async () => {
    const remoteWon = makeEntry({ id: 'r1', winner: 'remote' });
    const localWon = makeEntry({ id: 'l1', winner: 'local' });
    await journal.record(remoteWon);
    await journal.record(localWon);

    await service.flipAllToSide([remoteWon, localWon], 'local');

    // remote-won → flipped (local now wins); local-won → untouched
    expect((await journal.getEntry('r1'))?.status).toBe('flipped');
    expect((await journal.getEntry('l1'))?.status).toBe('unreviewed');
  });
});
