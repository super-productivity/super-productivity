import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { BoardsService } from './boards.service';
import { BoardsActions } from './store/boards.actions';
import { BoardCfg } from './boards.model';
import { DEFAULT_BOARD_CFG } from './boards.const';
import { DialogBoardEditComponent } from './dialog-board-edit/dialog-board-edit.component';
import { GlobalConfigService } from '../config/global-config.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';

describe('BoardsService', () => {
  let service: BoardsService;
  let dispatch: jasmine.Spy;
  let navigate: jasmine.Spy;
  let open: jasmine.Spy;
  let dialogResult: unknown;
  let updateSection: jasmine.Spy;
  let snackOpen: jasmine.Spy;
  // The store's boards: an added one shows up, as with the real reducer.
  const storeBoards = signal<BoardCfg[]>([]);
  const appFeatures = signal({ isBoardsEnabled: true });

  const board: BoardCfg = {
    id: 'b1',
    title: 'F.BOARDS.DEFAULT.KANBAN',
    cols: 3,
    panels: [{ id: 'p1', taskIds: ['t1', 't2'] } as any],
  };

  beforeEach(() => {
    storeBoards.set([]);
    snackOpen = jasmine.createSpy('snackOpen');
    dispatch = jasmine.createSpy('dispatch').and.callFake((action) => {
      if (action.type === BoardsActions.addBoard.type) {
        storeBoards.set([...storeBoards(), action.board]);
      }
    });
    navigate = jasmine.createSpy('navigate');
    dialogResult = undefined;
    updateSection = jasmine.createSpy('updateSection');
    appFeatures.set({ isBoardsEnabled: true });
    open = jasmine
      .createSpy('open')
      .and.callFake(() => ({ afterClosed: () => of(dialogResult) }));

    TestBed.configureTestingModule({
      providers: [
        { provide: Store, useValue: { dispatch, selectSignal: () => storeBoards } },
        { provide: SnackService, useValue: { open: snackOpen } },
        { provide: Router, useValue: { navigate } },
        { provide: MatDialog, useValue: { open } },
        { provide: GlobalConfigService, useValue: { appFeatures, updateSection } },
        {
          provide: TranslateService,
          useValue: {
            // 'PM' names a group of keys, as `instant` returns it.
            instant: (key: string): unknown =>
              key === board.title ? 'Kanban' : key === 'PM' ? { X: 'x' } : key,
          },
        },
      ],
    });
    service = TestBed.inject(BoardsService);
  });

  it('opens the dialog in create mode and goes to the saved view', async () => {
    dialogResult = 'new-id';
    await service.createBoard();
    expect(open).toHaveBeenCalledOnceWith(DialogBoardEditComponent, {
      restoreFocus: true,
      panelClass: 'fullscreen-xs-dialog',
      data: { board: DEFAULT_BOARD_CFG, isCreate: true, hints: [] },
    });
    expect(navigate).toHaveBeenCalledOnceWith(['/boards', 'new-id']);
  });

  it('opens the edit dialog full screen on phones', async () => {
    await service.editBoard(board);
    expect(open).toHaveBeenCalledOnceWith(DialogBoardEditComponent, {
      restoreFocus: true,
      panelClass: 'fullscreen-xs-dialog',
      data: { board },
    });
  });

  it('lets a created view arrive and names it in a snack', async () => {
    storeBoards.set([{ ...board, id: 'new-id', title: 'Mine' }]);
    dialogResult = 'new-id';
    await service.createBoard();
    expect(service.arrivalId()).toBe('new-id');
    expect(snackOpen).toHaveBeenCalledOnceWith({
      type: 'SUCCESS',
      msg: T.F.BOARDS.V.VIEW_CREATED,
      translateParams: { title: 'Mine' },
    });
    service.clearArrival();
    expect(service.arrivalId()).toBeNull();
  });

  it('opens the edit dialog with a column open', async () => {
    await service.editBoard(board, 'p1');
    expect(open).toHaveBeenCalledOnceWith(DialogBoardEditComponent, {
      restoreFocus: true,
      panelClass: 'fullscreen-xs-dialog',
      data: { board, openPanelId: 'p1' },
    });
  });

  it('stays put when the create dialog is cancelled', async () => {
    appFeatures.set({ isBoardsEnabled: false });
    await service.createBoard();
    expect(navigate).not.toHaveBeenCalled();
    expect(updateSection).not.toHaveBeenCalled();
    expect(snackOpen).not.toHaveBeenCalled();
    expect(service.arrivalId()).toBeNull();
  });

  it('turns Views on when a view is saved while they are off', async () => {
    dialogResult = 'new-id';
    await service.createBoard();
    expect(updateSection).not.toHaveBeenCalled();

    appFeatures.set({ isBoardsEnabled: false });
    await service.createBoard();
    expect(updateSection).toHaveBeenCalledOnceWith(
      'appFeatures',
      { isBoardsEnabled: true },
      true,
    );
    expect(navigate).toHaveBeenCalledWith(['/boards', 'new-id']);
  });

  it('duplicates with a translated title, fresh ids and no manual order', () => {
    service.duplicateBoard(board);
    const added = dispatch.calls.mostRecent().args[0] as ReturnType<
      typeof BoardsActions.addBoard
    >;
    expect(added.type).toBe(BoardsActions.addBoard.type);
    expect(added.board.title).toBe('Kanban (copy)');
    expect(added.board.id).not.toBe(board.id);
    expect(added.board.panels[0].id).not.toBe('p1');
    expect(added.board.panels[0].taskIds).toEqual([]);
    expect(navigate).toHaveBeenCalledOnceWith(['/boards', added.board.id]);
    expect(service.arrivalId()).toBe(added.board.id);
    expect(snackOpen).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ translateParams: { title: 'Kanban (copy)' } }),
    );
  });

  it('keeps a title that names a group of translation keys as typed', () => {
    service.duplicateBoard({ ...board, title: 'PM' });
    const added = dispatch.calls.mostRecent().args[0] as ReturnType<
      typeof BoardsActions.addBoard
    >;
    expect(added.board.title).toBe('PM (copy)');
  });

  it('duplicates every field of the board, including boardCols', () => {
    const list = { ...board, cols: 1, boardCols: 3, newerField: 'kept' } as BoardCfg;
    service.duplicateBoard(list);
    const added = dispatch.calls.mostRecent().args[0] as ReturnType<
      typeof BoardsActions.addBoard
    >;
    expect(added.board).toEqual(
      jasmine.objectContaining({
        cols: 1,
        boardCols: 3,
        newerField: 'kept',
      } as Partial<BoardCfg>),
    );
  });

  describe('setViewLayout', () => {
    it('switches a board to a list in one updateBoard, keeping its columns', () => {
      service.setViewLayout(board, 'list');
      expect(dispatch).toHaveBeenCalledOnceWith(
        BoardsActions.updateBoard({ id: 'b1', updates: { cols: 1, boardCols: 3 } }),
      );
    });

    it('switches a list back to the board it was', () => {
      service.setViewLayout({ ...board, cols: 1, boardCols: 3 }, 'board');
      expect(dispatch).toHaveBeenCalledOnceWith(
        BoardsActions.updateBoard({ id: 'b1', updates: { cols: 3 } }),
      );
    });

    it('dispatches nothing when the view already has that mode', () => {
      service.setViewLayout(board, 'board');
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  it('deletes only after confirming', () => {
    dialogResult = false;
    service.removeBoard(board);
    expect(dispatch).not.toHaveBeenCalled();

    dialogResult = true;
    service.removeBoard(board);
    expect(dispatch).toHaveBeenCalledOnceWith(BoardsActions.removeBoard({ id: 'b1' }));
  });
});
