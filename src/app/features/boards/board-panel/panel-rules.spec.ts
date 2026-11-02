import {
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
} from '../boards.model';
import { DEFAULT_PANEL_CFG } from '../boards.const';
import { panelToCriteria } from '../boards.util';
import { TaskCriteriaCtx } from '../../tasks/task-criteria/task-criteria.model';
import { TaskCopy } from '../../tasks/task.model';
import { createTaskCriteriaCtx } from '../../tasks/task-criteria/task-criteria';
import {
  getDropIndex,
  getNewTaskFields,
  getNewTaskTagsToAdd,
  getNewTaskTagsToRemove,
  getPanelChangesToMatch,
  hasMissingTag,
  orderPanelTasks,
  placeInOrder,
  withPartOrder,
} from './panel-rules';

const panel = (fields: Partial<BoardPanelCfg> = {}): BoardPanelCfg => ({
  ...DEFAULT_PANEL_CFG,
  id: 'p',
  title: 'Panel',
  taskDoneState: BoardPanelCfgTaskDoneState.All,
  scheduledState: BoardPanelCfgScheduledState.All,
  ...fields,
});

const task = (id: string, fields: Partial<TaskCopy> = {}): TaskCopy =>
  ({
    id,
    title: id,
    projectId: 'p1',
    tagIds: [],
    subTaskIds: [],
    isDone: false,
    timeSpentOnDay: {},
    timeEstimate: 0,
    timeSpent: 0,
    attachments: [],
    created: 0,
    ...fields,
  }) as TaskCopy;

const ctx: TaskCriteriaCtx = createTaskCriteriaCtx({
  todayStr: '2026-09-12',
  startOfNextDayDiffMs: 0,
  firstDayOfWeek: 1,
});

describe('panel rules', () => {
  describe('getPanelChangesToMatch (the missing-tag guard)', () => {
    const cfg = panel({ includedTagIds: ['a', 'b'] });

    it('gives the tags a task needs when they exist', () => {
      const changes = getPanelChangesToMatch(
        task('t', { tagIds: ['a'] }),
        panelToCriteria(cfg),
        ctx,
        new Set(['a', 'b']),
      );
      expect(new Set(changes?.tagIds)).toEqual(new Set(['a', 'b']));
    });

    it('refuses a change that would add a tag that does not exist', () => {
      expect(
        getPanelChangesToMatch(
          task('t', { tagIds: ['a'] }),
          panelToCriteria(cfg),
          ctx,
          new Set(['a']),
        ),
      ).toBeNull();
    });

    it('lets a task in that already has the missing tag', () => {
      expect(
        getPanelChangesToMatch(
          task('t', { tagIds: ['a', 'b'] }),
          panelToCriteria(cfg),
          ctx,
          new Set(['a']),
        ),
      ).not.toBeNull();
    });
  });

  it('hasMissingTag', () => {
    expect(hasMissingTag([], new Set())).toBeFalse();
    expect(hasMissingTag(['a'], new Set(['a']))).toBeFalse();
    expect(hasMissingTag(['a', 'x'], new Set(['a']))).toBeTrue();
  });

  describe('new tasks', () => {
    it('get every required tag (all) or the first one (any)', () => {
      expect(getNewTaskTagsToAdd(panel({ includedTagIds: ['a', 'b'] }))).toEqual([
        'a',
        'b',
      ]);
      expect(
        getNewTaskTagsToAdd(
          panel({ includedTagIds: ['a', 'b'], includedTagsMatch: 'any' }),
        ),
      ).toEqual(['a']);
      expect(getNewTaskTagsToAdd(panel())).toEqual([]);
    });

    it('lose excluded tags unless all of them must be present to exclude', () => {
      expect(getNewTaskTagsToRemove(panel({ excludedTagIds: ['x'] }))).toEqual(['x']);
      expect(
        getNewTaskTagsToRemove(
          panel({ excludedTagIds: ['x'], excludedTagsMatch: 'all' }),
        ),
      ).toEqual([]);
    });

    it('get tags, done state, the first project and priority', () => {
      const cfg = panel({
        includedTagIds: ['a'],
        taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
        projectIds: ['p2', 'p3'],
        priorityRule: '3',
      });
      expect(getNewTaskFields(cfg, panelToCriteria(cfg))).toEqual({
        tagIds: ['a'],
        isDone: false,
        projectId: 'p2',
        priority: 3,
      });
      expect(getNewTaskFields(panel(), panelToCriteria(panel()))).toEqual({});
    });
  });

  describe('orderPanelTasks', () => {
    const [a, b, c] = [task('a'), task('b'), task('c')];

    it('puts stored ids first (first occurrence wins), then the rest', () => {
      expect(orderPanelTasks([a, b, c], ['c', 'a', 'c']).map((t) => t.id)).toEqual([
        'c',
        'a',
        'b',
      ]);
    });

    it('skips stored ids that no longer match', () => {
      expect(orderPanelTasks([b], ['gone', 'b']).map((t) => t.id)).toEqual(['b']);
    });

    it('sorts by the comparator and direction when given', () => {
      const cmp = (x: TaskCopy, y: TaskCopy): number => x.id.localeCompare(y.id);
      expect(
        orderPanelTasks([b, a, c], ['c'], { cmp, dir: -1 }).map((t) => t.id),
      ).toEqual(['c', 'b', 'a']);
    });
  });

  it('placeInOrder moves ids to an index counted without them', () => {
    expect(placeInOrder(['a', 'b', 'c', 'd'], ['d', 'a'], 1)).toEqual([
      'b',
      'd',
      'a',
      'c',
    ]);
    expect(placeInOrder(['a', 'b'], ['x'], 2)).toEqual(['a', 'b', 'x']);
  });

  describe('getDropIndex', () => {
    // The panel's order; `d` and `e` are not rendered (done, or past the limit).
    const order = ['a', 'd', 'b', 'c', 'e'];
    const none = new Set<string>();

    it('places after the rendered item before the marker, in the whole order', () => {
      expect(getDropIndex(order, ['a', 'b', 'c'], none, 0)).toBe(0);
      expect(getDropIndex(order, ['a', 'b', 'c'], none, 1)).toBe(1);
      expect(getDropIndex(order, ['a', 'b', 'c'], none, 2)).toBe(3);
      // Past the last rendered item: hidden items after it stay after it.
      expect(getDropIndex(order, ['a', 'b', 'c'], none, 3)).toBe(4);
    });

    it('skips the dragged item of the same list and every moving one', () => {
      // `a` dragged down past `b`: CDK's index counts without it.
      expect(getDropIndex(order, ['a', 'b', 'c'], new Set(['a']), 1, 'a')).toBe(2);
      // A selection of `a` and the hidden `e`, dropped from another panel
      // after `b` (the duplicate `a` here is moving too).
      expect(getDropIndex(order, ['a', 'b', 'c'], new Set(['a', 'e']), 2)).toBe(2);
      // Only moving items before the marker: first.
      expect(getDropIndex(order, ['a', 'b'], new Set(['a']), 1)).toBe(0);
    });

    it('places first in an empty or unrendered panel', () => {
      expect(getDropIndex([], [], none, 0)).toBe(0);
      expect(getDropIndex(['d'], [], new Set(['x']), 0)).toBe(0);
    });
  });

  it('withPartOrder reorders one part in its own places, the others staying', () => {
    expect(withPartOrder(['a', 'd', 'b', 'c'], ['b', 'a', 'c'])).toEqual([
      'b',
      'd',
      'a',
      'c',
    ]);
  });
});
