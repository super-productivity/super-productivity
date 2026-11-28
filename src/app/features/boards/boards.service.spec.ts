import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { signal } from '@angular/core';
import { BoardsService } from './boards.service';
import { BoardsActions } from './store/boards.actions';
import { BoardCfg, BoardPanelCfgTaskDoneState } from './boards.model';
import { DEFAULT_BOARD_CFG, DEFAULT_PANEL_CFG } from './boards.const';
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
  let routerEvents: Subject<unknown>;
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
    routerEvents = new Subject();
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
        { provide: Router, useValue: { navigate, events: routerEvents, url: '/' } },
        { provide: MatDialog, useValue: { open } },
        { provide: GlobalConfigService, useValue: { appFeatures, updateSection } },
        {
          provide: TranslateService,
          useValue: {
            // 'PM' names a group of keys, as `instant` returns it.
            instant: (key: string): unknown =>
              key === board.title
                ? 'Kanban'
                : key === T.F.BOARDS.V.ALL_TASKS_TITLE
                  ? 'All tasks'
                  : key === 'PM'
                    ? { X: 'x' }
                    : key,
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

  it('opens the edit dialog full screen on phones, focusing the dialog itself', async () => {
    await service.editBoard(board);
    expect(open).toHaveBeenCalledOnceWith(DialogBoardEditComponent, {
      restoreFocus: true,
      panelClass: 'fullscreen-xs-dialog',
      data: { board },
      autoFocus: 'dialog',
    });
  });

  it('opens one editor for a second request while the first loads', async () => {
    await Promise.all([service.editBoard(board), service.editBoard(board)]);
    expect(open).toHaveBeenCalledTimes(1);
    await service.editBoard(board);
    expect(open).toHaveBeenCalledTimes(2);
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

  describe('openAllTasksList', () => {
    const allTasks: BoardCfg = {
      id: 'mine',
      title: 'Everything',
      cols: 1,
      panels: [
        {
          ...DEFAULT_PANEL_CFG,
          id: 'p',
          taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
        },
      ],
    };
    const goTo = (url: string): void => routerEvents.next(new NavigationEnd(1, url, url));

    it('adds a list of open tasks from all projects and opens it', () => {
      storeBoards.set([board]);
      service.openAllTasksList();

      expect(dispatch).toHaveBeenCalledTimes(1);
      const added: BoardCfg = dispatch.calls.mostRecent().args[0].board;
      expect(dispatch.calls.mostRecent().args[0].type).toBe(BoardsActions.addBoard.type);
      // the translated text is stored, not its key
      expect(added.title).toBe('All tasks');
      expect(added.cols).toBe(1);
      expect(added.panels.length).toBe(1);
      expect(added.panels[0].taskDoneState).toBe(BoardPanelCfgTaskDoneState.UnDone);
      expect(added.panels[0].projectIds).toEqual(['']);
      expect(added.id).not.toBe(board.id);
      expect(navigate).toHaveBeenCalledOnceWith(['/boards', added.id]);
      expect(service.arrivalId()).toBe(added.id);
      expect(snackOpen).toHaveBeenCalledTimes(1);
    });

    it('opens the one the user already has, renamed or not, without adding', () => {
      storeBoards.set([board, allTasks]);
      service.openAllTasksList();

      expect(dispatch).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledOnceWith(['/boards', 'mine']);
      expect(snackOpen).not.toHaveBeenCalled();
    });

    it('opens the same view on a second click', () => {
      service.openAllTasksList();
      service.openAllTasksList();

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(storeBoards().length).toBe(1);
    });

    it('turns Views on when they are off', () => {
      appFeatures.set({ isBoardsEnabled: false });
      storeBoards.set([allTasks]);
      service.openAllTasksList();

      expect(updateSection).toHaveBeenCalledOnceWith(
        'appFeatures',
        { isBoardsEnabled: true },
        true,
      );
    });

    it('knows when such a list is the page shown', () => {
      storeBoards.set([board, allTasks]);
      expect(service.isAllTasksListOpen()).toBe(false);

      goTo('/boards/b1');
      expect(service.isAllTasksListOpen()).toBe(false);
      goTo('/boards/mine?x=1');
      expect(service.isAllTasksListOpen()).toBe(true);
      goTo('/tag/TODAY/tasks');
      expect(service.isAllTasksListOpen()).toBe(false);
    });
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
