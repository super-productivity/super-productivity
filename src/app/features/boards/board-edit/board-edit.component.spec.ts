import { signal } from '@angular/core';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
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
import { ViewRuleChipComponent } from '../view-editor/view-rule-chip/view-rule-chip.component';
import { By } from '@angular/platform-browser';
import { LayoutService } from '../../../core-ui/layout/layout.service';

describe('BoardEditComponent with the view editor', () => {
  let fixture: ComponentFixture<BoardEditComponent>;
  let dispatch: jasmine.Spy;
  const tasks = signal<TaskCopy[]>([]);
  // The boards in the store; `open` puts the opened one there.
  const boards = signal<BoardCfg[]>([]);
  // Phones show every view as a list.
  const isXs = signal(false);
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
    isXs.set(false);
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
        { provide: LayoutService, useValue: { isXs } },
      ],
    }).compileComponents();
  });

  // NgModel writes its value asynchronously: wait before validating.
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const open = async (
    board: BoardCfg,
    openPanelId?: string,
  ): Promise<BoardEditComponent> => {
    opened = board;
    boards.set(board.id ? [board] : []);
    fixture = TestBed.createComponent(BoardEditComponent);
    fixture.componentRef.setInput('board', board);
    fixture.componentRef.setInput('openPanelId', openPanelId);
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
        fixture.nativeElement.querySelectorAll('view-editor-title .title-text'),
      ).map((title) => (title as HTMLElement).textContent!.trim());
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
    // The column stepper only shows for a board.
    expect(fixture.nativeElement.querySelector('.stepper')).toBeNull();
    editor().setLayout('board');
    fixture.detectChanges();
    expect(editor().model().cols).toBe(3);
    expect(fixture.nativeElement.querySelector('.stepper')).not.toBeNull();
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

  it("keeps a board's column count through List and back, and saves both fields", async () => {
    const fourSections = [
      { ...DEFAULT_PANEL_CFG, id: 'a', title: 'A' },
      { ...DEFAULT_PANEL_CFG, id: 'b', title: 'B' },
      { ...DEFAULT_PANEL_CFG, id: 'c', title: 'C' },
      { ...DEFAULT_PANEL_CFG, id: 'd', title: 'D' },
    ];
    const cmp = await open({ id: 'v', title: 'V', cols: 2, panels: fourSections });
    editor().setLayout('list');
    expect(editor().model().cols).toBe(1);
    editor().setLayout('board');
    // Not one column per section: the 2×2 it had.
    expect(editor().model().cols).toBe(2);

    editor().setLayout('list');
    await settle();
    cmp.save();
    expect(dispatch).toHaveBeenCalledOnceWith(
      BoardsActions.updateBoard({ id: 'v', updates: { cols: 1, boardCols: 2 } }),
    );

    dispatch.calls.reset();
    const list = await open({ ...opened, cols: 1, boardCols: 2 });
    editor().setLayout('board');
    await settle();
    list.save();
    expect(dispatch).toHaveBeenCalledOnceWith(
      BoardsActions.updateBoard({ id: 'v', updates: { cols: 2 } }),
    );
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

  it('steps the columns, never below 2 or to a fraction', async () => {
    const cmp = await open({
      id: 'v',
      title: 'V',
      cols: 3,
      panels: [{ ...DEFAULT_PANEL_CFG, id: 'a', title: 'A' }],
    });
    const [fewer, more] = Array.from(
      fixture.nativeElement.querySelectorAll('.stepper button'),
    ) as HTMLButtonElement[];
    fewer.click();
    fixture.detectChanges();
    expect(editor().model().cols).toBe(2);
    expect(fewer.disabled).toBeTrue();
    for (const value of [2.5, 1, 0]) {
      editor().setCols(value);
      expect(editor().model().cols).toBe(2);
    }
    more.click();
    more.click();
    fixture.detectChanges();
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
    // Dragging a card moves it too.
    editor().dropPanel({ previousIndex: 1, currentIndex: 0 } as CdkDragDrop<unknown>);
    expect(
      editor()
        .model()
        .panels.map((p) => p.title),
    ).toEqual(['A (copy)', 'A']);
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
    expect(sections()[0].parts()[0].part.missingCount).toBe(1);
    const chip: ViewRuleChipComponent = fixture.debugElement.query(
      By.directive(ViewRuleChipComponent),
    ).componentInstance;
    chip.toggleProject('p1');
    expect(editor().model().panels[0].projectIds).toEqual(['gone', 'p1']);
  });

  describe('sections collapse to their title and rule summary', () => {
    const three: BoardCfg = normalizeBoardForSave({
      id: 'v',
      title: 'V',
      cols: 3,
      panels: [
        { ...DEFAULT_PANEL_CFG, id: 'a', title: 'A' },
        {
          ...DEFAULT_PANEL_CFG,
          id: 'b',
          title: 'B',
          taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
        },
        { ...DEFAULT_PANEL_CFG, id: 'c', title: 'C' },
      ],
    });

    const cards = (): HTMLElement[] =>
      Array.from(fixture.nativeElement.querySelectorAll('view-editor-section'));
    const toggle = (card: HTMLElement): HTMLButtonElement | null =>
      card.querySelector('.section-toggle');
    /** Which cards show their rules. */
    const openCards = (): boolean[] =>
      cards().map((card) => !!card.querySelector('.section-body'));

    const text = (el: Element | null): string =>
      (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

    it('opens the first card; the others show only their title and summary', async () => {
      await open(three);
      expect(fixture.nativeElement.querySelector('[cdkfocusinitial]')).toBeNull();
      expect(openCards()).toEqual([true, false, false]);
      const [first, second, third] = cards();
      // The open card has its actions instead of a toggle.
      expect(toggle(first)).toBeNull();
      expect(first.querySelector('.section-menu-btn')).not.toBeNull();
      expect(toggle(second)!.getAttribute('aria-expanded')).toBe('false');
      expect(second.querySelector('.section-menu-btn')).toBeNull();
      // Only an open card's body exists.
      expect(toggle(second)!.hasAttribute('aria-controls')).toBeFalse();
      // No translations loaded: keys stand in for the labels.
      expect(text(second.querySelector('.summary'))).toContain(
        'F.BOARDS.EDITOR.RULE_DONE: F.BOARDS.FORM.TASK_DONE_STATE_UNDONE',
      );
      expect(text(third.querySelector('.summary'))).toContain(
        'F.BOARDS.EDITOR.EVERY_TASK',
      );
      expect(first.querySelector('.summary')).toBeNull();
      // Every title stays, so save can validate it; every card counts.
      expect(cards().map((card) => !!card.querySelector('view-editor-title'))).toEqual([
        true,
        true,
        true,
      ]);
      expect(cards().map((card) => !!card.querySelector('.count'))).toEqual([
        true,
        true,
        true,
      ]);
      expect(second.querySelector('[data-rule]')).toBeNull();
      // Numbered for screen readers.
      expect(second.querySelector('.card')!.getAttribute('aria-label')).toBe(
        'F.BOARDS.EDITOR.COLUMN_NR',
      );
    });

    it("opens the card asked for (a column's title), else the first", async () => {
      await open(three, 'c');
      expect(openCards()).toEqual([false, false, true]);
      // The dialog's first focus goes to that card's title, not the view's.
      expect(
        cards().map(
          (card) => !!card.querySelector('view-editor-title [cdkfocusinitial]'),
        ),
      ).toEqual([false, false, true]);
      await open(three, 'gone');
      expect(openCards()).toEqual([true, false, false]);
    });

    it('keeps one card open at a time', async () => {
      await open(three);
      toggle(cards()[1])!.click();
      fixture.detectChanges();
      expect(openCards()).toEqual([false, true, false]);
      expect(cards()[1].querySelector('[data-rule="done"]')).not.toBeNull();
      // Its summary opens a card too.
      (cards()[2].querySelector('.summary') as HTMLElement).click();
      fixture.detectChanges();
      expect(openCards()).toEqual([false, false, true]);
    });

    it('opens an added or duplicated card, keeps the open one when moving', async () => {
      await open(three);
      editor().addPanel();
      fixture.detectChanges();
      expect(openCards()).toEqual([false, false, false, true]);
      editor().duplicatePanel(1);
      fixture.detectChanges();
      expect(openCards()).toEqual([false, false, true, false, false]);
      editor().movePanel(2, -1);
      fixture.detectChanges();
      expect(openCards()).toEqual([false, true, false, false, false]);
      // Removing the open one leaves none open.
      editor().removePanel(1);
      fixture.detectChanges();
      expect(openCards()).toEqual([false, false, false, false]);
    });

    it('has no toggle with a single section', async () => {
      await open(DEFAULT_BOARD_CFG);
      expect(cards().length).toBe(1);
      expect(toggle(cards()[0])).toBeNull();
      expect(openCards()).toEqual([true]);
      expect(cards()[0].querySelector('.count')).not.toBeNull();
    });

    it('refuses to save an empty title in a collapsed card', async () => {
      const cmp = await open(three);
      editor().updatePanel(2, { ...editor().model().panels[2], title: '' });
      await settle();
      cmp.save();
      fixture.detectChanges();
      expect(dispatch).not.toHaveBeenCalled();
      expect(openCards()).toEqual([true, false, false]);
      expect(cards()[2].querySelector('mat-error')).not.toBeNull();
    });

    describe('on a phone', () => {
      beforeEach(() => isXs.set(true));

      const isHidden = (card: HTMLElement): boolean =>
        card.classList.contains('is-hidden');

      it('lists the sections as rows; a row opens its page in place of the form', async () => {
        await open(three);
        expect(cards().map((card) => !!card.querySelector('.phone-row'))).toEqual([
          true,
          true,
          true,
        ]);
        expect(
          fixture.nativeElement.querySelector('mat-button-toggle-group'),
        ).not.toBeNull();

        (cards()[1].querySelector('.phone-row-main') as HTMLElement).click();
        fixture.detectChanges();
        expect(cards().map(isHidden)).toEqual([true, false, true]);
        expect(cards()[1].querySelector('.page-head')).not.toBeNull();
        // The view's form is gone while the page shows.
        expect(fixture.nativeElement.querySelector('mat-button-toggle-group')).toBeNull();

        (cards()[1].querySelector('.page-head button') as HTMLElement).click();
        fixture.detectChanges();
        expect(cards().map(isHidden)).toEqual([false, false, false]);
        expect(cards()[1].querySelector('.phone-row')).not.toBeNull();
      });

      it("opens a column's page when its title asked for the editor", async () => {
        await open(three, 'c');
        expect(cards().map(isHidden)).toEqual([true, true, false]);
        expect(cards()[2].querySelector('.page-head')).not.toBeNull();
      });

      it('opens the page of a section whose title is empty on save', async () => {
        const cmp = await open(three);
        editor().updatePanel(2, { ...editor().model().panels[2], title: '' });
        await settle();
        cmp.save();
        await settle();
        expect(dispatch).not.toHaveBeenCalled();
        expect(cards().map(isHidden)).toEqual([true, true, false]);
        expect(cards()[2].querySelector('view-editor-title input')).not.toBeNull();
      });

      it("keeps the view's name as the dialog title, also on a section's page", async () => {
        const cmp = await open(three, 'a');
        expect(cards()[0].querySelector('.page-head')).not.toBeNull();
        editor().setTitle('');
        await settle();
        cmp.save();
        await settle();
        expect(dispatch).not.toHaveBeenCalled();
        expect(
          fixture.nativeElement.querySelector(
            '[mat-dialog-title] view-editor-title input',
          ),
        ).not.toBeNull();
      });

      it("opens an added section's page", async () => {
        await open(three);
        editor().addPanel();
        await settle();
        expect(cards().map(isHidden)).toEqual([true, true, true, false]);
        expect(cards()[3].querySelector('.page-head')).not.toBeNull();
      });
    });

    it('keeps an empty added rule of a card that is collapsed and opened again', async () => {
      await open(three);
      sections()[0].addRule('includedTags');
      await settle();
      toggle(cards()[1])!.click();
      fixture.detectChanges();
      toggle(cards()[0])!.click();
      fixture.detectChanges();
      expect(cards()[0].querySelector('[data-rule="includedTags"]')).not.toBeNull();
    });
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
    // Cards: every open match (done ones are in a collapsed group).
    expect(editor().counts()).toEqual([2, 2]);
    // A cached count follows the tasks.
    tasks.set([...tasks(), task({ id: 'new' })]);
    expect(editor().counts()).toEqual([3, 3]);
    tasks.set(tasks().filter((t) => t.id !== 'new'));
    // On a phone the board shows rows.
    isXs.set(true);
    expect(editor().counts()).toEqual([1, 1]);
    isXs.set(false);
    // List: open top-level rows.
    editor().setLayout('list');
    expect(editor().counts()).toEqual([1, 1]);
    fixture.detectChanges();
    // No translations loaded here: the pipe shows the key.
    expect(fixture.nativeElement.textContent).toContain('F.BOARDS.EDITOR.COUNT_ONE');
  });
  it('counts a Completed section as done', async () => {
    tasks.set([task({ id: 'a' }), task({ id: 'x', isDone: true })]);
    await open({
      id: 'v',
      title: 'V',
      cols: 2,
      panels: [
        {
          ...DEFAULT_PANEL_CFG,
          id: 'open',
          title: 'Open',
          taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
        },
        {
          ...DEFAULT_PANEL_CFG,
          id: 'done',
          title: 'Done',
          taskDoneState: BoardPanelCfgTaskDoneState.Done,
        },
      ],
    });
    expect(editor().counts()).toEqual([1, 1]);
    const done = fixture.nativeElement.querySelectorAll('view-editor-section')[1];
    expect(done.querySelector('.count')!.textContent).toContain(
      'F.BOARDS.EDITOR.COUNT_DONE',
    );
    // No list of the matching tasks: the count says enough.
    expect(fixture.nativeElement.querySelector('.preview')).toBeNull();
  });
});
