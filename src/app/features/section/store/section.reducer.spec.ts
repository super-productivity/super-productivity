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
    it('reorders ids within a context, leaving other contexts untouched', () => {
      const start = stateWithSections([
        makeSection({ id: 'a', contextId: 'p1' }),
        makeSection({ id: 'b', contextId: 'p1' }),
        makeSection({ id: 'c', contextId: 'p2' }),
      ]);
      const next = sectionReducer(
        start,
        updateSectionOrder({ contextId: 'p1', ids: ['b', 'a'] }),
      );
      // p2 sections keep their slot; p1 sections reorder.
      expect(next.ids).toEqual(['c', 'b', 'a']);
    });
  });

  describe('addTaskToSection (atomic placement)', () => {
    it('appends the task to an empty target section', () => {
      const start = stateWithSections([makeSection({ id: 's1', taskIds: [] })]);
      const next = sectionReducer(
        start,
        addTaskToSection({ sectionId: 's1', taskId: 't1', afterTaskId: null }),
      );
      expect(next.entities['s1']?.taskIds).toEqual(['t1']);
    });

    it('places the task after the anchor', () => {
      const start = stateWithSections([
        makeSection({ id: 's1', taskIds: ['a', 'b', 'c'] }),
      ]);
      const next = sectionReducer(
        start,
        addTaskToSection({ sectionId: 's1', taskId: 'NEW', afterTaskId: 'b' }),
      );
      expect(next.entities['s1']?.taskIds).toEqual(['a', 'b', 'NEW', 'c']);
    });

    it('places the task at the start when afterTaskId is null', () => {
      const start = stateWithSections([makeSection({ id: 's1', taskIds: ['a', 'b'] })]);
      const next = sectionReducer(
        start,
        addTaskToSection({ sectionId: 's1', taskId: 'NEW', afterTaskId: null }),
      );
      expect(next.entities['s1']?.taskIds).toEqual(['NEW', 'a', 'b']);
    });

    it('removes the task from any other section in the same pass (uniqueness)', () => {
      const start = stateWithSections([
        makeSection({ id: 's1', taskIds: ['x', 't1', 'y'] }),
        makeSection({ id: 's2', taskIds: [] }),
      ]);
      const next = sectionReducer(
        start,
        addTaskToSection({ sectionId: 's2', taskId: 't1', afterTaskId: null }),
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
        addTaskToSection({ sectionId: 's1', taskId: 'a', afterTaskId: 'b' }),
      );
      expect(next.entities['s1']?.taskIds).toEqual(['b', 'a', 'c']);
    });

    it('returns the same reference when nothing changes (target missing, task not in any section)', () => {
      const start = stateWithSections([makeSection({ id: 's1', taskIds: [] })]);
      const next = sectionReducer(
        start,
        addTaskToSection({
          sectionId: 'unknown',
          taskId: 't1',
          afterTaskId: null,
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
