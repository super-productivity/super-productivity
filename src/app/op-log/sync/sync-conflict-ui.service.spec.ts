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
