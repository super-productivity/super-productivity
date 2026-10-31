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

describe('BoardsService', () => {
  let service: BoardsService;
  let dispatch: jasmine.Spy;
  let navigate: jasmine.Spy;
  let open: jasmine.Spy;
  let dialogResult: unknown;

  const board: BoardCfg = {
    id: 'b1',
    title: 'F.BOARDS.DEFAULT.KANBAN',
    cols: 3,
    panels: [{ id: 'p1', taskIds: ['t1', 't2'] } as any],
  };

  beforeEach(() => {
    dispatch = jasmine.createSpy('dispatch');
    navigate = jasmine.createSpy('navigate');
    dialogResult = undefined;
    open = jasmine
      .createSpy('open')
      .and.callFake(() => ({ afterClosed: () => of(dialogResult) }));

    TestBed.configureTestingModule({
      providers: [
        { provide: Store, useValue: { dispatch, selectSignal: () => signal([]) } },
        { provide: Router, useValue: { navigate } },
        { provide: MatDialog, useValue: { open } },
        {
          provide: TranslateService,
          useValue: {
            instant: (key: string) => (key === board.title ? 'Kanban' : key),
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
      data: { board: DEFAULT_BOARD_CFG, isCreate: true },
    });
    expect(navigate).toHaveBeenCalledOnceWith(['/boards', 'new-id']);
  });

  it('stays put when the create dialog is cancelled', async () => {
    await service.createBoard();
    expect(navigate).not.toHaveBeenCalled();
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
