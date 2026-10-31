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
  getAddableRuleGroups,
  getPlannedDateChoice,
  getRuleValue,
  getSetRules,
  getSortValue,
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
  withRuleValue,
  withSortValue,
} from './view-editor.util';
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
          includedTagIds: ['a'],
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
      'includedTags',
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

  it('lets "Without tags" and the tag rules hide each other in the menu only', () => {
    const flat = (shown: Parameters<typeof getAddableRuleGroups>[0]): string[] =>
      getAddableRuleGroups(shown).flat();
    expect(flat(['includedTags'])).not.toContain('untagged');
    expect(flat(['untagged'])).not.toContain('includedTags');
    expect(flat(['untagged'])).not.toContain('excludedTags');
    expect(flat([])).toEqual([...VIEW_RULE_ORDER]);
    // A stored panel with both shows both.
    expect(
      getSetRules(panel({ isUntagged: true, excludedTagIds: ['a'] })).filter((r) =>
        ['untagged', 'excludedTags'].includes(r),
      ),
    ).toEqual(['excludedTags', 'untagged']);
  });

  it('drops empty groups from the Add-rule menu', () => {
    expect(getAddableRuleGroups(['project', 'backlog'])[0]).toEqual([
      'includedTags',
      'excludedTags',
      'untagged',
    ]);
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
