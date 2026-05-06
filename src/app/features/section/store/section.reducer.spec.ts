import { initialSectionState, sectionReducer } from './section.reducer';
import {
  addSection,
  addTaskToSection,
  deleteSection,
  removeTaskFromSection,
  updateSection,
  updateSectionOrder,
} from './section.actions';
import { Section, SectionState } from '../section.model';
import { MAX_SECTION_TITLE_LENGTH } from '../section.util';
import { WorkContextType } from '../../work-context/work-context.model';

const makeSection = (overrides: Partial<Section> = {}): Section => ({
  id: 's1',
  contextId: 'project1',
  contextType: WorkContextType.PROJECT,
  title: 'Section 1',
  taskIds: [],
  ...overrides,
});

const stateWithSections = (sections: Section[]): SectionState => {
  const ids = sections.map((s) => s.id);
  const entities: Record<string, Section> = {};
  for (const s of sections) entities[s.id] = s;
  return { ids, entities };
};

describe('sectionReducer', () => {
  describe('addSection', () => {
    it('adds the section with empty taskIds when none provided', () => {
      const action = addSection({
        section: {
          id: 'new',
          contextId: 'p1',
          contextType: WorkContextType.PROJECT,
          title: 'New',
        } as Section,
      });
      const next = sectionReducer(initialSectionState, action);
      expect(next.entities['new']?.taskIds).toEqual([]);
      expect(next.ids).toContain('new');
    });

    it('preserves provided taskIds', () => {
      const action = addSection({
        section: makeSection({ id: 'new', taskIds: ['t1', 't2'] }),
      });
      const next = sectionReducer(initialSectionState, action);
      expect(next.entities['new']?.taskIds).toEqual(['t1', 't2']);
    });
  });

  describe('deleteSection', () => {
    it('removes only the entity (no task cascade)', () => {
      const start = stateWithSections([
        makeSection({ id: 's1', taskIds: ['t1', 't2'] }),
        makeSection({ id: 's2' }),
      ]);
      const next = sectionReducer(start, deleteSection({ id: 's1' }));
      expect(next.entities['s1']).toBeUndefined();
      expect(next.entities['s2']).toBeDefined();
      expect(next.ids).toEqual(['s2']);
    });
  });

  describe('updateSection', () => {
    it('applies partial changes', () => {
      const start = stateWithSections([
        makeSection({ id: 's1', title: 'old', taskIds: ['t1'] }),
      ]);
      const next = sectionReducer(
        start,
        updateSection({ section: { id: 's1', changes: { title: 'new' } } }),
      );
      expect(next.entities['s1']?.title).toBe('new');
      expect(next.entities['s1']?.taskIds).toEqual(['t1']);
    });

    it('trims and caps incoming title length even when the action came from sync', () => {
      // Reducer-side enforcement defends against remote ops that bypass
      // the service-level sanitizer (e.g. a malicious peer's op-log entry).
      const start = stateWithSections([makeSection({ id: 's1', title: 'short' })]);
      const longTitle = '  ' + 'x'.repeat(500) + '  ';
      const next = sectionReducer(
        start,
        updateSection({ section: { id: 's1', changes: { title: longTitle } } }),
      );
      const updated = next.entities['s1']?.title;
      expect(updated?.length).toBe(MAX_SECTION_TITLE_LENGTH);
      expect(updated?.startsWith(' ')).toBe(false);
    });

    it('passes the empty string through (legitimate title clear)', () => {
      const start = stateWithSections([makeSection({ id: 's1', title: 'old' })]);
      const next = sectionReducer(
        start,
        updateSection({ section: { id: 's1', changes: { title: '' } } }),
      );
      expect(next.entities['s1']?.title).toBe('');
    });

    it('coerces null/undefined title to "" rather than crashing or storing null', () => {
      // A malformed remote op might ship `title: null` (or `undefined`).
      // The Section.title contract is `string` — must never become null.
      const start = stateWithSections([makeSection({ id: 's1', title: 'old' })]);
      const nextNull = sectionReducer(
        start,
        updateSection({
          section: { id: 's1', changes: { title: null as unknown as string } },
        }),
      );
      expect(nextNull.entities['s1']?.title).toBe('');
    });
  });

  describe('addSection (reducer-side title cap)', () => {
    it('trims whitespace and caps incoming title at 200 chars', () => {
      const longTitle = '  ' + 'y'.repeat(500) + '  ';
      const next = sectionReducer(
        initialSectionState,
        addSection({
          section: makeSection({ id: 'new', title: longTitle, taskIds: [] }),
        }),
      );
      expect(next.entities['new']?.title?.length).toBe(MAX_SECTION_TITLE_LENGTH);
      expect(next.entities['new']?.title?.startsWith(' ')).toBe(false);
    });

    it('does not throw when a malformed remote op ships an undefined title', () => {
      // Defends against `addSection({ section: { ...validShape, title: undefined } })`
      // — the threat model the reducer-side cap was added for. The
      // sanitizer must coerce, not throw.
      expect(() =>
        sectionReducer(
          initialSectionState,
          addSection({
            section: makeSection({
              id: 'new',
              title: undefined as unknown as string,
              taskIds: [],
            }),
          }),
        ),
      ).not.toThrow();
    });
  });

  describe('updateSectionOrder', () => {
    it('reorders sections within a context, leaving other-context slots intact', () => {
      const start = stateWithSections([
        makeSection({ id: 'a', contextId: 'p1' }),
        makeSection({ id: 'b', contextId: 'p1' }),
        makeSection({ id: 'c', contextId: 'p2' }),
      ]);
      const next = sectionReducer(
        start,
        updateSectionOrder({ contextId: 'p1', ids: ['b', 'a'] }),
      );
      // Other-context section c keeps its absolute slot at index 2.
      expect(next.ids).toEqual(['b', 'a', 'c']);
    });

    it('keeps interleaved cross-context sections in place', () => {
      const start = stateWithSections([
        makeSection({ id: 'a', contextId: 'p1' }),
        makeSection({ id: 'x', contextId: 'p2' }),
        makeSection({ id: 'b', contextId: 'p1' }),
        makeSection({ id: 'y', contextId: 'p2' }),
        makeSection({ id: 'c', contextId: 'p1' }),
      ]);
      const next = sectionReducer(
        start,
        updateSectionOrder({ contextId: 'p1', ids: ['c', 'b', 'a'] }),
      );
      // p1 slots (0, 2, 4) get reordered; p2 slots (1, 3) untouched.
      expect(next.ids).toEqual(['c', 'x', 'b', 'y', 'a']);
    });

    it('returns the same reference when the order is unchanged', () => {
      const start = stateWithSections([
        makeSection({ id: 'a', contextId: 'p1' }),
        makeSection({ id: 'b', contextId: 'p1' }),
      ]);
      const next = sectionReducer(
        start,
        updateSectionOrder({ contextId: 'p1', ids: ['a', 'b'] }),
      );
      expect(next).toBe(start);
    });

    it('ignores payload entries that no longer resolve to a context section', () => {
      // Sync-replay scenario: a remote client deleted section 'b' while
      // another reordered ['a','b','c'] → ['c','b','a']. Payload should
      // be applied as if 'b' is absent, leaving slots that map to {a,c}.
      const start = stateWithSections([
        makeSection({ id: 'a', contextId: 'p1' }),
        makeSection({ id: 'c', contextId: 'p1' }),
      ]);
      const next = sectionReducer(
        start,
        updateSectionOrder({ contextId: 'p1', ids: ['c', 'b', 'a'] }),
      );
      expect(next.ids).toEqual(['c', 'a']);
    });

    it('does not duplicate or wrap when payload is shorter than context slots', () => {
      const start = stateWithSections([
        makeSection({ id: 'a', contextId: 'p1' }),
        makeSection({ id: 'b', contextId: 'p1' }),
        makeSection({ id: 'c', contextId: 'p1' }),
      ]);
      // Partial payload: 'b' is moved to the first context-slot; the
      // missing entries ('a', 'c') append in their original order so
      // every section keeps a valid (and unique) slot.
      const next = sectionReducer(
        start,
        updateSectionOrder({ contextId: 'p1', ids: ['b'] }),
      );
      expect(next.ids).toEqual(['b', 'a', 'c']);
    });
  });

  describe('addTaskToSection (atomic placement)', () => {
    it('appends the task to an empty target section', () => {
      const start = stateWithSections([makeSection({ id: 's1', taskIds: [] })]);
      const next = sectionReducer(
        start,
        addTaskToSection({
          sectionId: 's1',
          taskId: 't1',
          afterTaskId: null,
          sourceSectionId: null,
        }),
      );
      expect(next.entities['s1']?.taskIds).toEqual(['t1']);
    });

    it('places the task after the anchor', () => {
      const start = stateWithSections([
        makeSection({ id: 's1', taskIds: ['a', 'b', 'c'] }),
      ]);
      const next = sectionReducer(
        start,
        addTaskToSection({
          sectionId: 's1',
          taskId: 'NEW',
          afterTaskId: 'b',
          sourceSectionId: null,
        }),
      );
      expect(next.entities['s1']?.taskIds).toEqual(['a', 'b', 'NEW', 'c']);
    });

    it('places the task at the start when afterTaskId is null', () => {
      const start = stateWithSections([makeSection({ id: 's1', taskIds: ['a', 'b'] })]);
      const next = sectionReducer(
        start,
        addTaskToSection({
          sectionId: 's1',
          taskId: 'NEW',
          afterTaskId: null,
          sourceSectionId: null,
        }),
      );
      expect(next.entities['s1']?.taskIds).toEqual(['NEW', 'a', 'b']);
    });

    it('strips from the explicit source when moving across sections', () => {
      const start = stateWithSections([
        makeSection({ id: 's1', taskIds: ['x', 't1', 'y'] }),
        makeSection({ id: 's2', taskIds: [] }),
      ]);
      const next = sectionReducer(
        start,
        addTaskToSection({
          sectionId: 's2',
          taskId: 't1',
          afterTaskId: null,
          sourceSectionId: 's1',
        }),
      );
      expect(next.entities['s1']?.taskIds).toEqual(['x', 'y']);
      expect(next.entities['s2']?.taskIds).toEqual(['t1']);
    });

    it('moves within the same section without duplicating', () => {
      const start = stateWithSections([
        makeSection({ id: 's1', taskIds: ['a', 'b', 'c'] }),
      ]);
      const next = sectionReducer(
        start,
        addTaskToSection({
          sectionId: 's1',
          taskId: 'a',
          afterTaskId: 'b',
          sourceSectionId: 's1',
        }),
      );
      expect(next.entities['s1']?.taskIds).toEqual(['b', 'a', 'c']);
    });

    it('does not touch other sections when sourceSectionId is null', () => {
      // Local invariant says t1 should only be in s1, but the test simulates
      // a stale duplicate (e.g. concurrent move). With explicit null source
      // the reducer must NOT touch the duplicate — replay determinism.
      const start = stateWithSections([
        makeSection({ id: 's1', taskIds: ['t1'] }),
        makeSection({ id: 's2', taskIds: [] }),
      ]);
      const next = sectionReducer(
        start,
        addTaskToSection({
          sectionId: 's2',
          taskId: 't1',
          afterTaskId: null,
          sourceSectionId: null,
        }),
      );
      expect(next.entities['s1']?.taskIds).toEqual(['t1']);
      expect(next.entities['s2']?.taskIds).toEqual(['t1']);
    });

    it('returns the same reference when nothing changes (target missing, no source)', () => {
      const start = stateWithSections([makeSection({ id: 's1', taskIds: [] })]);
      const next = sectionReducer(
        start,
        addTaskToSection({
          sectionId: 'unknown',
          taskId: 't1',
          afterTaskId: null,
          sourceSectionId: null,
        }),
      );
      expect(next).toBe(start);
    });
  });

  describe('removeTaskFromSection', () => {
    it('strips the task from the named section only', () => {
      const start = stateWithSections([
        makeSection({ id: 's1', taskIds: ['t1', 't2'] }),
        makeSection({ id: 's2', taskIds: ['t1', 't3'] }),
      ]);
      const next = sectionReducer(
        start,
        removeTaskFromSection({
          sectionId: 's1',
          taskId: 't1',
          workContextId: 'project1',
          workContextType: WorkContextType.PROJECT,
          workContextAfterTaskId: null,
        }),
      );
      expect(next.entities['s1']?.taskIds).toEqual(['t2']);
      // Other sections untouched — caller is responsible for the right source.
      expect(next.entities['s2']?.taskIds).toEqual(['t1', 't3']);
    });

    it('is a no-op when the section does not have the task', () => {
      const start = stateWithSections([makeSection({ id: 's1', taskIds: ['t1'] })]);
      const next = sectionReducer(
        start,
        removeTaskFromSection({
          sectionId: 's1',
          taskId: 'absent',
          workContextId: 'project1',
          workContextType: WorkContextType.PROJECT,
          workContextAfterTaskId: null,
        }),
      );
      expect(next).toBe(start);
    });

    it('is a no-op when the section is missing', () => {
      const start = stateWithSections([makeSection({ id: 's1', taskIds: ['t1'] })]);
      const next = sectionReducer(
        start,
        removeTaskFromSection({
          sectionId: 'missing',
          taskId: 't1',
          workContextId: 'project1',
          workContextType: WorkContextType.PROJECT,
          workContextAfterTaskId: null,
        }),
      );
      expect(next).toBe(start);
    });
  });
});
