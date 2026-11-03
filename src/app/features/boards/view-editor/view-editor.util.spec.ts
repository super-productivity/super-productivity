import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from '../boards.model';
import { DEFAULT_PANEL_CFG } from '../boards.const';
import { normalizeBoardForSave, toEditorModel } from '../boards.util';
import {
  getAddRuleMenu,
  getCountLabel,
  getPlannedDateChoice,
  getRuleConflict,
  getRuleParts,
  getRuleValue,
  getSetRules,
  getSortValue,
  getViewUpdates,
  OTHER_VALUE,
  PLANNED_HAS_DATE,
  PLANNED_NO_DATE,
  SORT_MANUAL,
  toEditorDisplayModel,
  toSavedBoard,
  toStoredTitle,
  VIEW_RULE_ORDER,
  withoutRule,
  withPlannedDateChoice,
  withRuleAdded,
  withProjectToggled,
  withRuleValue,
  withSortValue,
} from './view-editor.util';
import { T } from '../../../t.const';
import { UNTOUCHED_SAVE_FIXTURES } from '../testing/view-editor-fixtures';

const panel = (fields: Partial<BoardPanelCfg> = {}): BoardPanelCfg => ({
  ...DEFAULT_PANEL_CFG,
  id: 'p',
  title: 'P',
  ...fields,
});

const save = (p: BoardPanelCfg): BoardPanelCfg =>
  normalizeBoardForSave({ id: 'b', title: 'B', cols: 2, panels: [p] }).panels[0];

// Default views are titled with keys; everything else translates to itself.
const TRANSLATIONS = new Map([
  ['F.BOARDS.DEFAULT.KANBAN', 'Kanban'],
  ['F.BOARDS.DEFAULT.TO_DO', 'To Do'],
]);
const translate = (key: string): string => TRANSLATIONS.get(key) ?? key;

describe('view editor rules', () => {
  it('reads rule presence from stored values', () => {
    expect(getSetRules(panel())).toEqual([]);
    expect(
      getSetRules(
        panel({
          projectIds: ['deleted-project'],
          backlogState: BoardPanelCfgTaskTypeFilter.OnlyBacklog,
          excludedTagIds: ['a'],
          isUntagged: true,
          scheduledState: BoardPanelCfgScheduledState.Scheduled,
          deadlineState: 'unknownRule',
          taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
          isParentTasksOnly: true,
          priorityRule: '3',
          estimateRule: 'none',
          timeSpentRule: '99',
        }),
      ),
    ).toEqual([
      'project',
      'backlog',
      'excludedTags',
      'untagged',
      'plannedDate',
      'deadline',
      'done',
      'parentOnly',
      'priority',
      'estimate',
      'timeSpent',
    ]);
  });

  it('adds every rule and removes it again to the stored default', () => {
    for (const rule of VIEW_RULE_ORDER) {
      const added = withRuleAdded(panel(), rule);
      const removed = withoutRule(added, rule);
      expect(getSetRules(removed)).withContext(rule).toEqual([]);
      // Never null or undefined, which an op would carry.
      expect(Object.values(removed).some((v) => v === null || v === undefined))
        .withContext(rule)
        .toBeFalse();
      expect(save(removed)).withContext(rule).toEqual(save(panel()));
    }
  });

  it('adds rules with the first useful option', () => {
    expect(withRuleAdded(panel(), 'done').taskDoneState).toBe(
      BoardPanelCfgTaskDoneState.UnDone,
    );
    expect(withRuleAdded(panel(), 'plannedDate').dueState).toBe('today');
    expect(withRuleAdded(panel(), 'priority').priorityRule).toBe('3');
    expect(withRuleAdded(panel(), 'backlog').backlogState).toBe(
      BoardPanelCfgTaskTypeFilter.NoBacklog,
    );
    // Project and tags start empty: no rule until something is picked.
    expect(withRuleAdded(panel(), 'project')).toEqual(panel());
    expect(withRuleAdded(panel(), 'includedTags')).toEqual(panel());
  });

  it('removes a tag rule with its match mode', () => {
    const out = withoutRule(
      panel({ includedTagIds: ['a', 'b'], includedTagsMatch: 'any' }),
      'includedTags',
    );
    expect(out.includedTagIds).toEqual([]);
    expect('includedTagsMatch' in out).toBeFalse();
  });

  it('marks "Without tags" and the tag rules as conflicting in the menu only', () => {
    expect(getRuleConflict(['includedTags'], 'untagged')).toBe('includedTags');
    expect(getRuleConflict(['excludedTags'], 'untagged')).toBe('excludedTags');
    expect(getRuleConflict(['untagged'], 'includedTags')).toBe('untagged');
    expect(getRuleConflict(['untagged'], 'excludedTags')).toBe('untagged');
    expect(getRuleConflict(['includedTags'], 'excludedTags')).toBeUndefined();
    // Only those pairs: every other rule combines.
    for (const rule of VIEW_RULE_ORDER) {
      const others = VIEW_RULE_ORDER.filter(
        (r) => r !== rule && !['untagged', 'includedTags', 'excludedTags'].includes(r),
      );
      expect(getRuleConflict(others, rule)).withContext(rule).toBeUndefined();
    }
    // A stored panel with both shows both.
    expect(
      getSetRules(panel({ isUntagged: true, excludedTagIds: ['a'] })).filter((r) =>
        ['untagged', 'excludedTags'].includes(r),
      ),
    ).toEqual(['excludedTags', 'untagged']);
  });

  it('shows required tags a released client added, not "Without tags"', () => {
    const stored = panel({ isUntagged: true, includedTagIds: ['a'] });
    expect(getSetRules(stored)).toEqual(['includedTags']);
    // The editor model drops the stale flag, so removing the tags can't
    // bring "Without tags" back.
    const model = toEditorModel({ id: 'b', title: 'B', cols: 1, panels: [stored] })
      .panels[0];
    expect('isUntagged' in model).toBeFalse();
    expect(getSetRules(withoutRule(model, 'includedTags'))).toEqual([]);
  });

  it('lists every rule in its group, marking shown and conflicting ones', () => {
    const menu = getAddRuleMenu(['includedTags', 'parentOnly']);
    expect(menu.map((g) => g.label)).toEqual([
      T.F.BOARDS.EDITOR.GROUP_WHERE,
      T.F.BOARDS.EDITOR.GROUP_TAGS,
      T.F.BOARDS.EDITOR.GROUP_WHEN,
      T.F.BOARDS.EDITOR.GROUP_STATUS,
      T.F.BOARDS.EDITOR.GROUP_EFFORT,
    ]);
    expect(menu.flatMap((g) => g.items.map((i) => i.rule))).toEqual([...VIEW_RULE_ORDER]);
    expect(menu[1].items).toEqual([
      { rule: 'includedTags', isShown: true },
      { rule: 'excludedTags', isShown: false },
      { rule: 'untagged', isShown: false, conflictsWith: 'includedTags' },
    ]);
    expect(menu[3].items[1]).toEqual({ rule: 'parentOnly', isShown: true });
    expect(
      getAddRuleMenu([]).every((g) =>
        g.items.every((i) => !i.isShown && !i.conflictsWith),
      ),
    ).toBeTrue();
  });
});

describe('planned date select', () => {
  it('shows dueState first, then the scheduled state', () => {
    expect(getPlannedDateChoice(panel())).toBeNull();
    expect(getPlannedDateChoice(panel({ dueState: 'thisWeek' }))).toBe('thisWeek');
    expect(
      getPlannedDateChoice(
        panel({ scheduledState: BoardPanelCfgScheduledState.Scheduled }),
      ),
    ).toBe(PLANNED_HAS_DATE);
    expect(
      getPlannedDateChoice(
        panel({ scheduledState: BoardPanelCfgScheduledState.NotScheduled }),
      ),
    ).toBe(PLANNED_NO_DATE);
    expect(getPlannedDateChoice(panel({ dueState: 'none' }))).toBe(PLANNED_NO_DATE);
    expect(
      getPlannedDateChoice(
        panel({
          dueState: 'nextQuarter',
          scheduledState: BoardPanelCfgScheduledState.Scheduled,
        }),
      ),
    ).toBe(OTHER_VALUE);
    expect(
      getPlannedDateChoice(panel({ scheduledState: 7 as BoardPanelCfgScheduledState })),
    ).toBe(OTHER_VALUE);
  });

  it('shows "No date" a released client set next to a date rule', () => {
    const stored = panel({
      dueState: 'today',
      scheduledState: BoardPanelCfgScheduledState.NotScheduled,
    });
    expect(getPlannedDateChoice(stored)).toBe(PLANNED_NO_DATE);
    const model = toEditorModel({ id: 'b', title: 'B', cols: 1, panels: [stored] })
      .panels[0];
    expect('dueState' in model).toBeFalse();
    expect(getPlannedDateChoice(model)).toBe(PLANNED_NO_DATE);
  });

  it('writes both fields only from a choice', () => {
    const dated = panel({
      dueState: 'today',
      scheduledState: BoardPanelCfgScheduledState.Scheduled,
    });
    const hasDate = withPlannedDateChoice(dated, PLANNED_HAS_DATE);
    expect('dueState' in hasDate).toBeFalse();
    expect(hasDate.scheduledState).toBe(BoardPanelCfgScheduledState.Scheduled);

    const noDate = withPlannedDateChoice(dated, PLANNED_NO_DATE);
    expect('dueState' in noDate).toBeFalse();
    expect(noDate.scheduledState).toBe(BoardPanelCfgScheduledState.NotScheduled);

    const tomorrow = withPlannedDateChoice(panel(), 'tomorrow');
    expect(tomorrow.dueState).toBe('tomorrow');
    // The "scheduled" a date rule implies is added on save.
    expect(save(tomorrow).scheduledState).toBe(BoardPanelCfgScheduledState.Scheduled);

    const removed = withPlannedDateChoice(dated, null);
    expect('dueState' in removed).toBeFalse();
    expect(removed.scheduledState).toBe(BoardPanelCfgScheduledState.All);

    // "Other (kept)" keeps an unknown value.
    const unknown = panel({ dueState: 'nextQuarter' });
    expect(withPlannedDateChoice(unknown, OTHER_VALUE)).toBe(unknown);
  });

  it('round-trips each option through the select', () => {
    for (const choice of [PLANNED_HAS_DATE, PLANNED_NO_DATE, 'overdue', 'nextMonth']) {
      expect(getPlannedDateChoice(withPlannedDateChoice(panel(), choice))).toBe(choice);
    }
  });
});

describe('select rule values', () => {
  it('shows unknown values as "Other (kept)" and keeps them', () => {
    const p = panel({
      priorityRule: '9',
      backlogState: 9 as BoardPanelCfgTaskTypeFilter,
    });
    expect(getRuleValue(p, 'priority')).toBe(OTHER_VALUE);
    expect(getRuleValue(p, 'backlog')).toBe(OTHER_VALUE);
    expect(withRuleValue(p, 'priority', OTHER_VALUE)).toBe(p);
    expect(withRuleValue(p, 'priority', '1').priorityRule).toBe('1');
    expect(getRuleValue(panel({ estimateRule: '1800000' }), 'estimate')).toBe('1800000');
  });

  it('maps the sort select onto the editor sort key', () => {
    expect(getSortValue(panel())).toBe(SORT_MANUAL);
    expect(getSortValue(panel({ sortKey: 'priority' }))).toBe('priority');
    expect(getSortValue(panel({ sortKey: 'energy' }))).toBe(OTHER_VALUE);
    const manual = withSortValue(
      panel({ sortKey: 'title', sortDir: 'desc' }),
      SORT_MANUAL,
    );
    expect('sortKey' in manual || 'sortDir' in manual).toBeFalse();
    expect(save(withSortValue(panel(), 'plannedDate')).sortBy).toBe('dueDate');
    const unknown = panel({ sortKey: 'energy' });
    expect(withSortValue(unknown, OTHER_VALUE)).toBe(unknown);
  });
});

describe('titles', () => {
  const kanban: BoardCfg = {
    id: 'KANBAN_DEFAULT',
    title: 'F.BOARDS.DEFAULT.KANBAN',
    cols: 3,
    panels: [panel({ id: 'TODO', title: 'F.BOARDS.DEFAULT.TO_DO' })],
  };

  it('shows translated titles and keeps the key while the text is unchanged', () => {
    const model = toEditorDisplayModel(kanban, translate);
    expect(model.title).toBe('Kanban');
    expect(model.panels[0].title).toBe('To Do');
    expect(toSavedBoard(model, kanban, translate)).toEqual(
      normalizeBoardForSave(toEditorModel(kanban)),
    );
    const renamed = toSavedBoard(
      { ...model, title: 'My board', panels: [{ ...model.panels[0], title: 'Next' }] },
      kanban,
      translate,
    );
    expect(renamed.title).toBe('My board');
    expect(renamed.panels[0].title).toBe('Next');
  });

  it('keeps a key only for its own translation', () => {
    expect(toStoredTitle('Kanban', 'F.BOARDS.DEFAULT.KANBAN', translate)).toBe(
      'F.BOARDS.DEFAULT.KANBAN',
    );
    expect(toStoredTitle('Kanban', undefined, translate)).toBe('Kanban');
    expect(toStoredTitle('Kanban 2', 'F.BOARDS.DEFAULT.KANBAN', translate)).toBe(
      'Kanban 2',
    );
  });

  describe('the hidden title of a single-section list', () => {
    const list = (viewTitle: string, sectionTitle: string): BoardCfg => ({
      id: 'v',
      title: viewTitle,
      cols: 1,
      panels: [panel({ title: sectionTitle })],
    });
    const rename = (stored: BoardCfg, title: string): BoardCfg =>
      toSavedBoard(
        { ...toEditorDisplayModel(stored, translate), title },
        stored,
        translate,
      );

    it('follows the view title when it was empty or the same', () => {
      expect(rename(list('', ''), 'New').panels[0].title).toBe('New');
      expect(rename(list('Old', 'Old'), 'New').panels[0].title).toBe('New');
    });

    it('keeps a title of its own', () => {
      expect(rename(list('Inbox', 'Open work'), 'New').panels[0].title).toBe('Open work');
    });

    it('is not touched once sections show their titles', () => {
      const stored: BoardCfg = { ...list('Old', 'Old'), cols: 2 };
      expect(rename(stored, 'New').panels[0].title).toBe('Old');
    });
  });
});

describe('toSavedBoard: an untouched save', () => {
  for (const fixture of UNTOUCHED_SAVE_FIXTURES) {
    it(fixture.name, () => {
      const model = toEditorDisplayModel(fixture.board, translate);
      expect(toSavedBoard(model, fixture.board, translate)).toEqual(fixture.saved);
    });
  }
});

describe('getViewUpdates', () => {
  const board: BoardCfg = {
    id: 'v',
    title: 'V',
    cols: 2,
    panels: [panel({ id: 'a', taskIds: ['t1', 't2'] }), panel({ id: 'b' })],
  };

  it('is null when nothing changed', () => {
    expect(getViewUpdates(board, { ...board }, board)).toBeNull();
  });

  it('holds only the changed fields', () => {
    expect(getViewUpdates(board, { ...board, cols: 3 }, board)).toEqual({ cols: 3 });
  });

  it('gives changed panels the task order they have now', () => {
    const current = { ...board, panels: [{ ...board.panels[0], taskIds: ['t2'] }] };
    const saved = {
      ...board,
      panels: [
        { ...board.panels[0], title: 'Renamed' },
        panel({ id: 'new', taskIds: [] }),
      ],
    };
    const updates = getViewUpdates(board, saved, current);
    expect(updates?.panels?.map((p) => p.taskIds)).toEqual([['t2'], []]);
    expect(updates?.panels?.[0].title).toBe('Renamed');
  });

  it('leaves out unchanged panels, so a synced reorder stays', () => {
    const current = { ...board, panels: [{ ...board.panels[0], taskIds: ['t2'] }] };
    expect(getViewUpdates(board, { ...board, title: 'W' }, current)).toEqual({
      title: 'W',
    });
  });
});

describe('getRuleParts', () => {
  const known = {
    projects: new Set(['p1', 'p2']),
    tags: new Set(['t1', 't2']),
  };
  const parts = (p: BoardPanelCfg): ReturnType<typeof getRuleParts> =>
    getRuleParts(p, getSetRules(p), known);

  it('has no parts without rules', () => {
    expect(parts(panel())).toEqual([]);
  });

  it('names select rules by their option, in rule order', () => {
    expect(
      parts(
        panel({ taskDoneState: BoardPanelCfgTaskDoneState.UnDone, priorityRule: '3' }),
      ),
    ).toEqual([
      {
        rule: 'done',
        label: T.F.BOARDS.EDITOR.RULE_DONE,
        value: T.F.BOARDS.FORM.TASK_DONE_STATE_UNDONE,
      },
      {
        rule: 'priority',
        label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_PRIORITY,
        value: T.F.TASK.CMP.PRIORITY_HIGH,
      },
    ]);
  });

  it('marks a value this client does not know as other', () => {
    expect(parts(panel({ deadlineState: 'someday' }))).toEqual([
      {
        rule: 'deadline',
        label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_DEADLINE,
        isOther: true,
      },
    ]);
  });

  it('lists the known projects and tags in stored order and counts the missing', () => {
    const [project, required, excluded] = parts(
      panel({
        projectIds: ['p2', 'gone', 'p1'],
        includedTagIds: ['t1', 'missing'],
        excludedTagIds: ['t2'],
      }),
    );
    expect(project).toEqual(
      jasmine.objectContaining({ rule: 'project', ids: ['p2', 'p1'], missingCount: 1 }),
    );
    expect(required).toEqual(
      jasmine.objectContaining({ rule: 'includedTags', ids: ['t1'], missingCount: 1 }),
    );
    expect(excluded).toEqual(
      jasmine.objectContaining({ rule: 'excludedTags', ids: ['t2'], missingCount: 0 }),
    );
  });

  it('shows a match mode only when it is not the default and there are several tags', () => {
    const match = (fields: Partial<BoardPanelCfg>): (string | undefined)[] =>
      parts(panel(fields)).map((p) => p.match);
    expect(match({ includedTagIds: ['t1', 't2'] })).toEqual([undefined]);
    expect(match({ includedTagIds: ['t1', 't2'], includedTagsMatch: 'all' })).toEqual([
      undefined,
    ]);
    expect(match({ includedTagIds: ['t1', 't2'], includedTagsMatch: 'any' })).toEqual([
      T.F.BOARDS.FORM.TAGS_MATCH_ANY,
    ]);
    expect(match({ includedTagIds: ['t1'], includedTagsMatch: 'any' })).toEqual([
      undefined,
    ]);
    expect(match({ excludedTagIds: ['t1', 't2'] })).toEqual([undefined]);
    expect(match({ excludedTagIds: ['t1', 't2'], excludedTagsMatch: 'all' })).toEqual([
      T.F.BOARDS.FORM.TAGS_EXCLUDED_MATCH_ALL,
    ]);
  });

  it('shows rules without a value by their label', () => {
    expect(parts(panel({ isUntagged: true, isParentTasksOnly: true }))).toEqual([
      { rule: 'untagged', label: T.F.BOARDS.EDITOR.RULE_UNTAGGED },
      { rule: 'parentOnly', label: T.F.BOARDS.FORM.ONLY_PARENT_TASKS },
    ]);
  });

  it('gives an added rule that is still empty no ids', () => {
    // An empty project rule is stored as [''] and an empty tag rule as [].
    const p = panel({ projectIds: [''], includedTagIds: [] });
    expect(parts(p)).toEqual([]);
    expect(getRuleParts(p, ['project', 'includedTags'], known)).toEqual([
      {
        rule: 'project',
        label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_PROJECT,
        ids: [],
        missingCount: 0,
      },
      {
        rule: 'includedTags',
        label: T.F.BOARDS.FORM.TAGS_REQUIRED,
        ids: [],
        missingCount: 0,
      },
    ]);
  });
});

describe('getCountLabel', () => {
  it('counts tasks, or done tasks for a "Completed" section', () => {
    expect(getCountLabel(1, panel())).toEqual({
      key: T.F.BOARDS.EDITOR.COUNT_ONE,
      nr: 1,
    });
    expect(getCountLabel(0, panel())).toEqual({ key: T.F.BOARDS.EDITOR.COUNT, nr: 0 });
    expect(
      getCountLabel(3, panel({ taskDoneState: BoardPanelCfgTaskDoneState.UnDone })),
    ).toEqual({ key: T.F.BOARDS.EDITOR.COUNT, nr: 3 });
    for (const nr of [0, 1, 4]) {
      expect(
        getCountLabel(nr, panel({ taskDoneState: BoardPanelCfgTaskDoneState.Done })),
      ).toEqual({ key: T.F.BOARDS.EDITOR.COUNT_DONE, nr });
    }
  });
});

describe('withProjectToggled', () => {
  it('toggles one project, keeping deleted ones, and stores none as all projects', () => {
    const p = panel({ projectIds: ['gone'] });
    const added = withProjectToggled(p, 'p1');
    expect(added.projectIds).toEqual(['gone', 'p1']);
    expect(withProjectToggled(added, 'p1').projectIds).toEqual(['gone']);
    expect(withProjectToggled(panel({ projectIds: ['p1'] }), 'p1').projectIds).toEqual([
      '',
    ]);
    expect(withProjectToggled(panel({ projectIds: [''] }), 'p1').projectIds).toEqual([
      'p1',
    ]);
  });
});
