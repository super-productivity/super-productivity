/* eslint-disable @typescript-eslint/naming-convention */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TagListComponent } from './tag-list.component';
import { Store } from '@ngrx/store';
import { of, BehaviorSubject } from 'rxjs';
import { Tag, TagState } from '../tag.model';
import { ProjectState, Project } from '../../project/project.model';
import { TaskCopy } from '../../tasks/task.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { selectTagFeatureState } from '../store/tag.reducer';
import { selectProjectFeatureState } from '../../project/store/project.selectors';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DEFAULT_TAG } from '../tag.const';
import { DEFAULT_PROJECT } from '../../project/project.const';

describe('TagListComponent', () => {
  let component: TagListComponent;
  let fixture: ComponentFixture<TagListComponent>;
  let tagState$: BehaviorSubject<TagState>;
  let projectState$: BehaviorSubject<ProjectState>;
  let workContext$: BehaviorSubject<{
    activeId: string;
    activeType: WorkContextType;
  } | null>;

  const createMockTag = (id: string, title: string): Tag =>
    ({
      ...DEFAULT_TAG,
      id,
      title,
      color: '#ff0000',
      taskIds: [],
    }) as Tag;

  const createMockProject = (id: string, title: string): Project =>
    ({
      ...DEFAULT_PROJECT,
      id,
      title,
      taskIds: [],
    }) as Project;

  const createMockTask = (overrides: Partial<TaskCopy> = {}): TaskCopy =>
    ({
      id: 'task-1',
      title: 'Test Task',
      subTaskIds: [],
      timeSpentOnDay: {},
      timeSpent: 0,
      timeEstimate: 0,
      isDone: false,
      tagIds: [],
      created: Date.now(),
      attachments: [],
      projectId: null,
      ...overrides,
    }) as TaskCopy;

  beforeEach(async () => {
    tagState$ = new BehaviorSubject<TagState>({ ids: [], entities: {} });
    projectState$ = new BehaviorSubject<ProjectState>({ ids: [], entities: {} });
    workContext$ = new BehaviorSubject<{
      activeId: string;
      activeType: WorkContextType;
    } | null>(null);

    const storeMock = {
      select: (selector: any) => {
        if (selector === selectTagFeatureState) {
          return tagState$.asObservable();
        } else if (selector === selectProjectFeatureState) {
          return projectState$.asObservable();
        }
        return of(null);
      },
    };

    const workContextServiceMock = {
      activeWorkContextTypeAndId$: workContext$.asObservable(),
    };

    await TestBed.configureTestingModule({
      imports: [TagListComponent, NoopAnimationsModule],
      providers: [
        { provide: Store, useValue: storeMock },
        { provide: WorkContextService, useValue: workContextServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TagListComponent);
    component = fixture.componentInstance;
  });

  describe('initial state handling', () => {
    it('should return empty tags array before store emits', () => {
      const task = createMockTask({ tagIds: ['tag-1', 'tag-2'] });
      fixture.componentRef.setInput('task', task);
      fixture.detectChanges();

      expect(component.tags()).toEqual([]);
    });

    it('should handle task with no tagIds gracefully', () => {
      const task = createMockTask({ tagIds: [] });
      fixture.componentRef.setInput('task', task);
      fixture.detectChanges();

      expect(component.tags()).toEqual([]);
    });
  });

  describe('tag resolution', () => {
    it('should resolve tags when store has data', () => {
      const tag1 = createMockTag('tag-1', 'Alpha Tag');
      const tag2 = createMockTag('tag-2', 'Beta Tag');
      tagState$.next({
        ids: ['tag-1', 'tag-2'],
        entities: { 'tag-1': tag1, 'tag-2': tag2 },
      });

      const task = createMockTask({ tagIds: ['tag-1', 'tag-2'] });
      fixture.componentRef.setInput('task', task);
      fixture.detectChanges();

      const tags = component.tags();
      expect(tags.length).toBe(2);
      expect(tags[0].id).toBe('tag-1');
      expect(tags[1].id).toBe('tag-2');
    });

    it('should sort tags alphabetically by title', () => {
      const tagZ = createMockTag('tag-z', 'Zebra');
      const tagA = createMockTag('tag-a', 'Apple');
      const tagM = createMockTag('tag-m', 'Mango');
      tagState$.next({
        ids: ['tag-z', 'tag-a', 'tag-m'],
        entities: { 'tag-z': tagZ, 'tag-a': tagA, 'tag-m': tagM },
      });

      const task = createMockTask({ tagIds: ['tag-z', 'tag-a', 'tag-m'] });
      fixture.componentRef.setInput('task', task);
      fixture.detectChanges();

      const tags = component.tags();
      expect(tags.map((t) => t.title)).toEqual(['Apple', 'Mango', 'Zebra']);
    });

    it('should filter out missing tag entities gracefully', () => {
      const tag1 = createMockTag('tag-1', 'Existing Tag');
      tagState$.next({
        ids: ['tag-1'],
        entities: { 'tag-1': tag1 },
      });

      const task = createMockTask({
        tagIds: ['tag-1', 'missing-tag', 'another-missing'],
      });
      fixture.componentRef.setInput('task', task);
      fixture.detectChanges();

      const tags = component.tags();
      expect(tags.length).toBe(1);
      expect(tags[0].id).toBe('tag-1');
    });
  });

  describe('tagsToHide input', () => {
    it('should hide specified tags', () => {
      const tag1 = createMockTag('tag-1', 'Alpha');
      const tag2 = createMockTag('tag-2', 'Beta');
      const tag3 = createMockTag('tag-3', 'Gamma');
      tagState$.next({
        ids: ['tag-1', 'tag-2', 'tag-3'],
        entities: { 'tag-1': tag1, 'tag-2': tag2, 'tag-3': tag3 },
      });

      const task = createMockTask({ tagIds: ['tag-1', 'tag-2', 'tag-3'] });
      fixture.componentRef.setInput('task', task);
      fixture.componentRef.setInput('tagsToHide', ['tag-2']);
      fixture.detectChanges();

      const tags = component.tags();
      expect(tags.length).toBe(2);
      expect(tags.map((t) => t.id)).toEqual(['tag-1', 'tag-3']);
    });

    it('should show all tags when tagsToHide is empty array', () => {
      const tag1 = createMockTag('tag-1', 'Alpha');
      const tag2 = createMockTag('tag-2', 'Beta');
      tagState$.next({
        ids: ['tag-1', 'tag-2'],
        entities: { 'tag-1': tag1, 'tag-2': tag2 },
      });

      const task = createMockTask({ tagIds: ['tag-1', 'tag-2'] });
      fixture.componentRef.setInput('task', task);
      fixture.componentRef.setInput('tagsToHide', []);
      fixture.detectChanges();

      const tags = component.tags();
      expect(tags.length).toBe(2);
    });
  });

  describe('work context filtering', () => {
    it('should hide current work context tag by default', () => {
      const tag1 = createMockTag('tag-1', 'Alpha');
      const tag2 = createMockTag('tag-2', 'Beta');
      tagState$.next({
        ids: ['tag-1', 'tag-2'],
        entities: { 'tag-1': tag1, 'tag-2': tag2 },
      });

      workContext$.next({ activeId: 'tag-1', activeType: WorkContextType.TAG });

      const task = createMockTask({ tagIds: ['tag-1', 'tag-2'] });
      fixture.componentRef.setInput('task', task);
      fixture.detectChanges();

      const tags = component.tags();
      expect(tags.length).toBe(1);
      expect(tags[0].id).toBe('tag-2');
    });
  });

  describe('project tag display', () => {
    it('should show project tag when isShowProjectTagAlways is true', () => {
      const project = createMockProject('proj-1', 'My Project');
      projectState$.next({
        ids: ['proj-1'],
        entities: { 'proj-1': project },
      });

      const task = createMockTask({ projectId: 'proj-1', tagIds: [] });
      fixture.componentRef.setInput('task', task);
      fixture.componentRef.setInput('isShowProjectTagAlways', true);
      fixture.detectChanges();

      const tags = component.tags();
      expect(tags.length).toBe(1);
      expect(tags[0].id).toBe('proj-1');
    });

    it('should not show project tag when isShowProjectTagNever is true', () => {
      const project = createMockProject('proj-1', 'My Project');
      projectState$.next({
        ids: ['proj-1'],
        entities: { 'proj-1': project },
      });

      workContext$.next({ activeId: 'tag-1', activeType: WorkContextType.TAG });

      const task = createMockTask({ projectId: 'proj-1', tagIds: [] });
      fixture.componentRef.setInput('task', task);
      fixture.componentRef.setInput('isShowProjectTagNever', true);
      fixture.detectChanges();

      const tags = component.tags();
      expect(tags.length).toBe(0);
    });

    it('should show project tag when work context is a TAG', () => {
      const project = createMockProject('proj-1', 'My Project');
      projectState$.next({
        ids: ['proj-1'],
        entities: { 'proj-1': project },
      });

      workContext$.next({ activeId: 'tag-1', activeType: WorkContextType.TAG });

      const task = createMockTask({ projectId: 'proj-1', tagIds: [] });
      fixture.componentRef.setInput('task', task);
      fixture.detectChanges();

      const tags = component.tags();
      expect(tags.length).toBe(1);
      expect(tags[0].id).toBe('proj-1');
    });

    it('should not show project tag when work context is a PROJECT', () => {
      const project = createMockProject('proj-1', 'My Project');
      projectState$.next({
        ids: ['proj-1'],
        entities: { 'proj-1': project },
      });

      workContext$.next({ activeId: 'proj-1', activeType: WorkContextType.PROJECT });

      const task = createMockTask({ projectId: 'proj-1', tagIds: [] });
      fixture.componentRef.setInput('task', task);
      fixture.detectChanges();

      const tags = component.tags();
      expect(tags.length).toBe(0);
    });

    it('should place project tag first before regular tags', () => {
      const project = createMockProject('proj-1', 'Zulu Project');
      const tag1 = createMockTag('tag-1', 'Alpha');
      const tag2 = createMockTag('tag-2', 'Beta');

      projectState$.next({
        ids: ['proj-1'],
        entities: { 'proj-1': project },
      });
      tagState$.next({
        ids: ['tag-1', 'tag-2'],
        entities: { 'tag-1': tag1, 'tag-2': tag2 },
      });

      const task = createMockTask({ projectId: 'proj-1', tagIds: ['tag-1', 'tag-2'] });
      fixture.componentRef.setInput('task', task);
      fixture.componentRef.setInput('isShowProjectTagAlways', true);
      fixture.detectChanges();

      const tags = component.tags();
      expect(tags.length).toBe(3);
      expect(tags[0].id).toBe('proj-1');
      expect(tags[1].id).toBe('tag-1');
      expect(tags[2].id).toBe('tag-2');
    });

    it('should handle missing project entity gracefully', () => {
      projectState$.next({
        ids: [],
        entities: {},
      });

      const task = createMockTask({ projectId: 'missing-project', tagIds: [] });
      fixture.componentRef.setInput('task', task);
      fixture.componentRef.setInput('isShowProjectTagAlways', true);
      fixture.detectChanges();

      const tags = component.tags();
      expect(tags.length).toBe(0);
    });
  });

  describe('reactive updates', () => {
    it('should update tags when store emits new state', () => {
      const task = createMockTask({ tagIds: ['tag-1'] });
      fixture.componentRef.setInput('task', task);
      fixture.detectChanges();

      expect(component.tags().length).toBe(0);

      const tag1 = createMockTag('tag-1', 'New Tag');
      tagState$.next({
        ids: ['tag-1'],
        entities: { 'tag-1': tag1 },
      });
      fixture.detectChanges();

      expect(component.tags().length).toBe(1);
      expect(component.tags()[0].title).toBe('New Tag');
    });
  });
});
