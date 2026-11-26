import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { BehaviorSubject } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BoardsComponent } from './boards.component';
import { BoardsService } from './boards.service';
import { BoardCfg } from './boards.model';
import { TaskMultiSelectService } from '../tasks/task-multi-select.service';
import { LS } from '../../core/persistence/storage-keys.const';
import { setSelectedTask } from '../tasks/store/task.actions';

describe('BoardsComponent', () => {
  let fixture: ComponentFixture<BoardsComponent>;
  let params$: BehaviorSubject<ParamMap>;
  let boards: WritableSignal<BoardCfg[]>;
  let navigate: jasmine.Spy;
  let dispatch: jasmine.Spy;
  let clearSelection: jasmine.Spy;
  let arrivalId: WritableSignal<string | null>;

  const board = (id: string): BoardCfg => ({ id, title: id, cols: 1, panels: [] });

  beforeEach(async () => {
    params$ = new BehaviorSubject(convertToParamMap({ boardId: 'a' }));
    boards = signal([board('a'), board('b')]);
    navigate = jasmine.createSpy('navigate');
    dispatch = jasmine.createSpy('dispatch');
    clearSelection = jasmine.createSpy('clear');
    arrivalId = signal(null);
    localStorage.removeItem(LS.SELECTED_BOARD);

    await TestBed.configureTestingModule({
      imports: [BoardsComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: { paramMap: params$ } },
        { provide: Router, useValue: { navigate } },
        { provide: Store, useValue: { dispatch } },
        { provide: TaskMultiSelectService, useValue: { clear: clearSelection } },
        {
          provide: BoardsService,
          useValue: {
            boards,
            createBoard: () => undefined,
            arrivalId,
            clearArrival: () => arrivalId.set(null),
          },
        },
      ],
    })
      // The board itself is covered by its own specs.
      .overrideTemplate(BoardsComponent, '')
      .compileComponents();

    fixture = TestBed.createComponent(BoardsComponent);
    fixture.detectChanges();
  });

  afterEach(() => localStorage.removeItem(LS.SELECTED_BOARD));

  it('shows the routed view and remembers it for /boards', () => {
    expect(fixture.componentInstance.board()?.id).toBe('a');
    expect(localStorage.getItem(LS.SELECTED_BOARD)).toBe('a');
  });

  it('drops the selection and open task when switching views', () => {
    clearSelection.calls.reset();
    dispatch.calls.reset();

    params$.next(convertToParamMap({ boardId: 'b' }));
    fixture.detectChanges();

    expect(clearSelection).toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(setSelectedTask({ id: null }));
    expect(localStorage.getItem(LS.SELECTED_BOARD)).toBe('b');
  });

  it('leaves a view that was deleted, replacing the history entry', () => {
    boards.set([board('b')]);
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledOnceWith(['/boards'], { replaceUrl: true });
  });

  it('lets a view just created arrive, once', () => {
    expect(fixture.componentInstance.switchParams().isArrival).toBeFalse();
    arrivalId.set('b');
    params$.next(convertToParamMap({ boardId: 'b' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.switchParams().isArrival).toBeTrue();

    // Another view's animation ending doesn't use it up.
    fixture.componentInstance.onSwitchDone('a:list');
    expect(arrivalId()).toBe('b');
    fixture.componentInstance.onSwitchDone('b:list');
    expect(arrivalId()).toBeNull();
    expect(fixture.componentInstance.switchParams().isArrival).toBeFalse();
  });

  it('switches with the mode too: the viewSwitch state is the id and the mode', () => {
    expect(fixture.componentInstance.switchState()).toBe('a:list');
    boards.set([{ ...board('a'), cols: 2 }, board('b')]);
    fixture.detectChanges();
    expect(fixture.componentInstance.switchState()).toBe('a:board');
  });

  it('lets a view that arrives as a board clear its arrival', () => {
    boards.set([board('a'), { ...board('b'), cols: 3 }]);
    arrivalId.set('b');
    params$.next(convertToParamMap({ boardId: 'b' }));
    fixture.detectChanges();
    fixture.componentInstance.onSwitchDone('b');
    expect(arrivalId()).toBe('b');
    fixture.componentInstance.onSwitchDone('b:board');
    expect(arrivalId()).toBeNull();
  });

  it('drops the selection, but not the open task, on a mode switch', () => {
    clearSelection.calls.reset();
    dispatch.calls.reset();

    boards.set([{ ...board('a'), cols: 2 }, board('b')]);
    fixture.detectChanges();
    expect(clearSelection).toHaveBeenCalledTimes(1);

    // Another edit of the view keeps the selection.
    boards.set([{ ...board('a'), cols: 3, title: 'Renamed' }, board('b')]);
    fixture.detectChanges();
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
