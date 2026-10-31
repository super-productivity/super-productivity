import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BoardEditComponent } from './board-edit.component';
import { BoardCfg, BoardPanelCfg, BoardPanelCfgTaskDoneState } from '../boards.model';
import { DEFAULT_BOARD_CFG, DEFAULT_BOARDS, DEFAULT_PANEL_CFG } from '../boards.const';
import { BoardsActions } from '../store/boards.actions';
import { selectAllBoards } from '../store/boards.selectors';
import { normalizeBoardForSave, toEditorModel } from '../boards.util';
import { UNTOUCHED_SAVE_FIXTURES } from '../testing/view-editor-fixtures';
import { ViewCriteriaContextService } from '../view-criteria-context.service';
import { createTaskCriteriaCtx } from '../../tasks/task-criteria/task-criteria';
import { selectAllTasksInActiveProjects } from '../../tasks/store/task.selectors';
import { TaskCopy } from '../../tasks/task.model';
import { ProjectService } from '../../project/project.service';
import { MenuTreeService } from '../../menu-tree/menu-tree.service';
import { TagService } from '../../tag/tag.service';
import { TaskService } from '../../tasks/task.service';
import { ViewEditorComponent } from '../view-editor/view-editor.component';
import { ViewEditorSectionComponent } from '../view-editor/view-editor-section/view-editor-section.component';
import { By } from '@angular/platform-browser';

describe('BoardEditComponent with the view editor', () => {
  let fixture: ComponentFixture<BoardEditComponent>;
  let dispatch: jasmine.Spy;
  const tasks = signal<TaskCopy[]>([]);
  // The boards in the store; `open` puts the opened one there.
  const boards = signal<BoardCfg[]>([]);
  let opened: BoardCfg;

  const task = (fields: Partial<TaskCopy> & { id: string }): TaskCopy =>
    ({
      title: fields.id,
      projectId: 'p1',
      subTaskIds: [],
      tagIds: [],
      isDone: false,
      timeSpentOnDay: {},
      ...fields,
    }) as TaskCopy;

  beforeEach(async () => {
    dispatch = jasmine.createSpy('dispatch');
    tasks.set([]);
    await TestBed.configureTestingModule({
      imports: [BoardEditComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        {
          provide: Store,
          useValue: {
            dispatch,
            selectSignal: (selector: unknown) =>
              selector === selectAllTasksInActiveProjects
                ? tasks
                : selector === selectAllBoards
                  ? boards
                  : signal(undefined),
          },
        },
        {
          provide: ViewCriteriaContextService,
          useValue: {
            projects: signal([]),
            ctx: signal(
              createTaskCriteriaCtx({
                todayStr: '2026-10-30',
                startOfNextDayDiffMs: 0,
                firstDayOfWeek: 1,
              }),
            ),
          },
        },
        {
          provide: ProjectService,
          useValue: {
            listInTreeOrder: signal([{ id: 'p1', title: 'Work', theme: {} }]),
          },
        },
        { provide: MenuTreeService, useValue: { projectFolderMap: signal(new Map()) } },
        {
          provide: TagService,
          useValue: {
            tags: signal([{ id: 'tag1', title: 'Tag 1' }]),
            tagsInTreeOrder: signal([{ id: 'tag1', title: 'Tag 1' }]),
            tagsNoMyDayAndNoListInTreeOrder: signal([]),
          },
        },
        { provide: TaskService, useValue: {} },
      ],
    }).compileComponents();
  });

  // NgModel writes its value asynchronously: wait before validating.
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const open = async (board: BoardCfg): Promise<BoardEditComponent> => {
    opened = board;
    boards.set(board.id ? [board] : []);
    fixture = TestBed.createComponent(BoardEditComponent);
    fixture.componentRef.setInput('board', board);
    await settle();
    return fixture.componentInstance;
  };
  const editor = (): ViewEditorComponent =>
    fixture.debugElement.query(By.directive(ViewEditorComponent)).componentInstance;
  const sections = (): ViewEditorSectionComponent[] =>
    fixture.debugElement
      .queryAll(By.directive(ViewEditorSectionComponent))
      .map((el) => el.componentInstance);
  /** The board as the store holds it after the save. */
  const savedBoard = (): BoardCfg => {
    const action = dispatch.calls.mostRecent()?.args[0];
    if (!action) {
      return opened;
    }
    return action.type === BoardsActions.updateBoard.type
      ? { ...opened, ...action.updates }
      : action.board;
  };

  describe('an untouched save stores the board unchanged', () => {
    for (const f of UNTOUCHED_SAVE_FIXTURES) {
      it(f.name, async () => {
        const cmp = await open(f.board);
        // What saving stores: the board as `normalizeBoardForSave` keeps it.
        expect(editor().buildBoard()).toEqual(f.saved);
        expect(f.saved).toEqual(normalizeBoardForSave(toEditorModel(f.board)));
        // Nothing changed, so no op, even where saving would normalize.
        cmp.save();
        expect(dispatch).not.toHaveBeenCalled();
      });
    }

    it('sends only a rename for a board saving would normalize', async () => {
      const f = UNTOUCHED_SAVE_FIXTURES.find((x) => x.saved !== x.board)!;
      const cmp = await open(f.board);
      editor().setTitle('Renamed');
      await settle();
      cmp.save();
      expect(dispatch).toHaveBeenCalledOnceWith(
        BoardsActions.updateBoard({ id: f.board.id, updates: { title: 'Renamed' } }),
      );
    });

    it('keeps the title keys of a default view in another language', async () => {
      const translate = TestBed.inject(TranslateService);
      translate.setTranslation('de', {
        F: { BOARDS: { DEFAULT: { KANBAN: 'Kanban-Tafel', TO_DO: 'Zu erledigen' } } },
      });
      translate.use('de');
      const kanban = DEFAULT_BOARDS.find((b) => b.id === 'KANBAN_DEFAULT')!;
      await open(kanban);
      const titles = Array.from(
        fixture.nativeElement.querySelectorAll('input:not([type=number])'),
      ).map((input) => (input as HTMLInputElement).value);
      expect(titles).toContain('Kanban-Tafel');
      expect(titles).toContain('Zu erledigen');
      expect(editor().buildBoard()).toEqual(kanban);
      fixture.componentInstance.save();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  it('starts a new view with one section and refuses to save without a title', async () => {
    const cmp = await open(DEFAULT_BOARD_CFG);
    expect(editor().model().panels.length).toBe(1);
    // The only section of a list has no title field.
    expect(fixture.nativeElement.querySelectorAll('input').length).toBe(1);
    expect(fixture.nativeElement.querySelector('mat-error')).toBeNull();

    cmp.save();
    fixture.detectChanges();
    expect(dispatch).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('mat-error')).not.toBeNull();

    editor().setTitle('Focus');
    await settle();
    cmp.save();
    const board = savedBoard();
    expect(dispatch.calls.mostRecent().args[0].type).toBe(BoardsActions.addBoard.type);
    expect(board.id).toBeTruthy();
    expect(board.cols).toBe(1);
    // The hidden section title takes the view's.
    expect(board.panels.map((p) => p.title)).toEqual(['Focus']);
  });

  describe('saving an edited view', () => {
    const stored: BoardCfg = normalizeBoardForSave({
      id: 'v',
      title: 'V',
      cols: 2,
      panels: [
        { ...DEFAULT_PANEL_CFG, id: 'a', title: 'A', taskIds: ['t1', 't2'] },
        { ...DEFAULT_PANEL_CFG, id: 'b', title: 'B', taskIds: [] },
      ],
    });

    it('dispatches nothing when nothing changed', async () => {
      (await open(stored)).save();
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('sends only the changed fields', async () => {
      const cmp = await open(stored);
      editor().setTitle('Renamed');
      await settle();
      cmp.save();
      expect(dispatch).toHaveBeenCalledOnceWith(
        BoardsActions.updateBoard({ id: 'v', updates: { title: 'Renamed' } }),
      );
    });

    it('keeps a task order and a field that synced in while it was open', async () => {
      const cmp = await open(stored);
      boards.set([
        {
          ...stored,
          cols: 3,
          panels: [{ ...stored.panels[0], taskIds: ['t2', 't1'] }, stored.panels[1]],
        },
      ]);
      editor().updatePanel(1, { ...editor().model().panels[1], title: 'Later' });
      await settle();
      cmp.save();
      const { updates } = dispatch.calls.mostRecent().args[0];
      expect(updates.cols).toBeUndefined();
      expect(updates.panels.map((p: BoardPanelCfg) => p.title)).toEqual(['A', 'Later']);
      expect(updates.panels[0].taskIds).toEqual(['t2', 't1']);
    });

    it("doesn't bring back a view deleted while it was open", async () => {
      const cmp = await open(stored);
      boards.set([]);
      editor().setTitle('Renamed');
      await settle();
      cmp.save();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  it('switches between List and Board', async () => {
    await open({
      id: 'v',
      title: 'V',
      cols: 1,
      panels: [
        { ...DEFAULT_PANEL_CFG, id: 'a', title: 'A' },
        { ...DEFAULT_PANEL_CFG, id: 'b', title: 'B' },
        { ...DEFAULT_PANEL_CFG, id: 'c', title: 'C' },
      ],
    });
    expect(fixture.nativeElement.querySelector('input[type=number]')).toBeNull();
    editor().setLayout('board');
    fixture.detectChanges();
    expect(editor().model().cols).toBe(3);
    expect(fixture.nativeElement.querySelector('input[type=number]')).not.toBeNull();
    editor().setLayout('list');
    expect(editor().model().cols).toBe(1);

    const single = await open({
      id: 'w',
      title: 'W',
      cols: 1,
      panels: [{ ...DEFAULT_PANEL_CFG, id: 'a', title: 'A' }],
    });
    editor().setLayout('board');
    expect(editor().model().cols).toBe(2);
    expect(single).toBeTruthy();
  });

  it('requires shown section titles', async () => {
    const cmp = await open({
      id: 'v',
      title: 'V',
      cols: 2,
      panels: [{ ...DEFAULT_PANEL_CFG, id: 'a', title: 'A' }],
    });
    editor().updatePanel(0, { ...editor().model().panels[0], title: '' });
    await settle();
    cmp.save();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('adds a section, prefilling the title the only section of a list hid', async () => {
    await open({ ...DEFAULT_BOARD_CFG, id: '', title: '' });
    editor().setTitle('Mine');
    editor().addPanel();
    fixture.detectChanges();
    expect(
      editor()
        .model()
        .panels.map((p) => p.title),
    ).toEqual(['Mine', '']);
    expect(editor().isSectionTitleShown()).toBeTrue();
  });

  it('shows the following hidden title as the view title when a section is added', async () => {
    await open({
      id: 'v',
      title: 'Old',
      cols: 1,
      panels: [{ ...DEFAULT_PANEL_CFG, id: 'a', title: 'Old' }],
    });
    editor().setTitle('New');
    editor().duplicatePanel(0);
    expect(
      editor()
        .model()
        .panels.map((p) => p.title),
    ).toEqual(['New', 'New (copy)']);

    // A title of its own stays.
    await open({
      id: 'w',
      title: 'Old',
      cols: 1,
      panels: [{ ...DEFAULT_PANEL_CFG, id: 'a', title: 'Own' }],
    });
    editor().setTitle('New');
    editor().addPanel();
    expect(
      editor()
        .model()
        .panels.map((p) => p.title),
    ).toEqual(['Own', '']);
  });

  it('refuses a Columns value that is not a whole number of at least 2', async () => {
    const cmp = await open({
      id: 'v',
      title: 'V',
      cols: 3,
      panels: [{ ...DEFAULT_PANEL_CFG, id: 'a', title: 'A' }],
    });
    const input: HTMLInputElement =
      fixture.nativeElement.querySelector('input[type=number]');
    for (const value of ['2.5', '1', '']) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await settle();
      cmp.save();
      expect(dispatch).not.toHaveBeenCalled();
      expect(editor().model().cols).toBe(3);
    }
    input.value = '4';
    input.dispatchEvent(new Event('input'));
    await settle();
    cmp.save();
    expect(savedBoard().cols).toBe(4);
  });

  it('moves, duplicates and removes sections', async () => {
    await open({
      id: 'v',
      title: 'V',
      cols: 2,
      panels: [
        { ...DEFAULT_PANEL_CFG, id: 'a', title: 'A', taskIds: ['t1'] },
        { ...DEFAULT_PANEL_CFG, id: 'b', title: 'B' },
      ],
    });
    editor().movePanel(0, 1);
    expect(
      editor()
        .model()
        .panels.map((p) => p.id),
    ).toEqual(['b', 'a']);
    editor().duplicatePanel(1);
    const copy = editor().model().panels[2];
    expect(copy.title).toBe('A (copy)');
    expect(copy.taskIds).toEqual([]);
    expect(copy.id).not.toBe('a');
    editor().removePanel(0);
    expect(
      editor()
        .model()
        .panels.map((p) => p.title),
    ).toEqual(['A', 'A (copy)']);
  });

  it('adds and removes a rule through a section', async () => {
    await open({
      id: 'v',
      title: 'V',
      cols: 2,
      panels: [{ ...DEFAULT_PANEL_CFG, id: 'a', title: 'A' }],
    });
    sections()[0].addRule('done');
    fixture.detectChanges();
    expect(editor().model().panels[0].taskDoneState).toBe(
      BoardPanelCfgTaskDoneState.UnDone,
    );
    expect(fixture.nativeElement.querySelector('[data-rule="done"]')).not.toBeNull();
    sections()[0].removeRule('done');
    fixture.detectChanges();
    expect(editor().model().panels[0].taskDoneState).toBe(BoardPanelCfgTaskDoneState.All);
    expect(fixture.nativeElement.querySelector('[data-rule="done"]')).toBeNull();
  });

  it('keeps an empty added tag rule shown, and saves it as no rule', async () => {
    const cmp = await open({
      id: 'v',
      title: 'V',
      cols: 2,
      panels: [{ ...DEFAULT_PANEL_CFG, id: 'a', title: 'A' }],
    });
    sections()[0].addRule('includedTags');
    await settle();
    expect(
      fixture.nativeElement.querySelector('[data-rule="includedTags"]'),
    ).not.toBeNull();
    cmp.save();
    expect(savedBoard().panels[0].includedTagIds).toEqual([]);
  });

  it('keeps deleted project ids when the project selection changes', async () => {
    await open({
      id: 'v',
      title: 'V',
      cols: 2,
      panels: [{ ...DEFAULT_PANEL_CFG, id: 'a', title: 'A', projectIds: ['gone'] }],
    });
    const section = sections()[0];
    expect(section.deletedProjectCount()).toBe(1);
    section.setProjects({ value: ['p1'] } as never);
    expect(editor().model().panels[0].projectIds).toEqual(['p1', 'gone']);
  });

  it('counts what each section header will show, for the chosen layout', async () => {
    tasks.set([
      task({ id: 'parent', subTaskIds: ['child'] }),
      task({ id: 'child', parentId: 'parent' }),
      task({ id: 'done', isDone: true }),
    ]);
    const undone: BoardPanelCfg = {
      ...DEFAULT_PANEL_CFG,
      id: 'u',
      title: 'Open',
      taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
    };
    await open({
      id: 'v',
      title: 'V',
      cols: 2,
      panels: [undone, { ...DEFAULT_PANEL_CFG, id: 'all', title: 'All' }],
    });
    // Cards: every match.
    expect(editor().counts()).toEqual([2, 3]);
    // A cached count follows the tasks.
    tasks.set([...tasks(), task({ id: 'new' })]);
    expect(editor().counts()).toEqual([3, 4]);
    tasks.set(tasks().filter((t) => t.id !== 'new'));
    // List: open top-level rows.
    editor().setLayout('list');
    expect(editor().counts()).toEqual([1, 1]);
    fixture.detectChanges();
    // No translations loaded here: the pipe shows the key.
    expect(fixture.nativeElement.textContent).toContain('F.BOARDS.EDITOR.COUNT_ONE');
  });
});
