import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { SectionService } from './section.service';
import { Section } from './section.model';
import { addTaskToSection } from './store/section.actions';
import { WorkContextType } from '../work-context/work-context.model';

describe('SectionService', () => {
  let service: SectionService;
  let store: MockStore;

  const makeSection = (overrides: Partial<Section> = {}): Section => ({
    id: 'sec-1',
    contextId: 'project-1',
    contextType: WorkContextType.PROJECT,
    title: 'Section',
    taskIds: [],
    ...overrides,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SectionService, provideMockStore()],
    });
    service = TestBed.inject(SectionService);
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
  });

  describe('moveTaskToTop', () => {
    it('prepends the task with a null anchor and the section as its own source', () => {
      service.moveTaskToTop('sec-1', 'task-1');

      expect(store.dispatch).toHaveBeenCalledWith(
        addTaskToSection({
          sectionId: 'sec-1',
          taskId: 'task-1',
          afterTaskId: null,
          sourceSectionId: 'sec-1',
        }),
      );
    });
  });

  describe('moveTaskToBottom', () => {
    it('anchors after the section last task, excluding the moved task', () => {
      const section = makeSection({
        id: 'sec-1',
        taskIds: ['task-1', 'task-2', 'task-3'],
      });

      service.moveTaskToBottom(section, 'task-1');

      expect(store.dispatch).toHaveBeenCalledWith(
        addTaskToSection({
          sectionId: 'sec-1',
          taskId: 'task-1',
          afterTaskId: 'task-3',
          sourceSectionId: 'sec-1',
        }),
      );
    });

    it('anchors after the new last task when the moved task is already last', () => {
      const section = makeSection({
        id: 'sec-1',
        taskIds: ['task-1', 'task-2', 'task-3'],
      });

      service.moveTaskToBottom(section, 'task-3');

      expect(store.dispatch).toHaveBeenCalledWith(
        addTaskToSection({
          sectionId: 'sec-1',
          taskId: 'task-3',
          afterTaskId: 'task-2',
          sourceSectionId: 'sec-1',
        }),
      );
    });

    it('uses a null anchor when the task is the only one in the section', () => {
      const section = makeSection({ id: 'sec-1', taskIds: ['task-1'] });

      service.moveTaskToBottom(section, 'task-1');

      expect(store.dispatch).toHaveBeenCalledWith(
        addTaskToSection({
          sectionId: 'sec-1',
          taskId: 'task-1',
          afterTaskId: null,
          sourceSectionId: 'sec-1',
        }),
      );
    });

    it('anchors after the current last task when the moved task is not yet in the section', () => {
      const section = makeSection({ id: 'sec-1', taskIds: ['task-1', 'task-2'] });

      service.moveTaskToBottom(section, 'task-99');

      expect(store.dispatch).toHaveBeenCalledWith(
        addTaskToSection({
          sectionId: 'sec-1',
          taskId: 'task-99',
          afterTaskId: 'task-2',
          sourceSectionId: 'sec-1',
        }),
      );
    });
  });
});
