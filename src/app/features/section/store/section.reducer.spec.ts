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
        removeTaskFromSection({ sectionId: 's1', taskId: 't1' }),
      );
      expect(next.entities['s1']?.taskIds).toEqual(['t2']);
      // Other sections untouched — caller is responsible for the right source.
      expect(next.entities['s2']?.taskIds).toEqual(['t1', 't3']);
    });

    it('is a no-op when the section does not have the task', () => {
      const start = stateWithSections([makeSection({ id: 's1', taskIds: ['t1'] })]);
      const next = sectionReducer(
        start,
        removeTaskFromSection({ sectionId: 's1', taskId: 'absent' }),
      );
      expect(next).toBe(start);
    });

    it('is a no-op when the section is missing', () => {
      const start = stateWithSections([makeSection({ id: 's1', taskIds: ['t1'] })]);
      const next = sectionReducer(
        start,
        removeTaskFromSection({ sectionId: 'missing', taskId: 't1' }),
      );
      expect(next).toBe(start);
    });
  });
});
