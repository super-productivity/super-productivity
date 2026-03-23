import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { SearchPageComponent } from './search-page.component';
import { TaskService } from '../../features/tasks/task.service';
import { ProjectService } from '../../features/project/project.service';
import { TagService } from '../../features/tag/tag.service';
import { NavigateToTaskService } from '../../core-ui/navigate-to-task/navigate-to-task.service';
import { BehaviorSubject } from 'rxjs';
import { Task } from '../../features/tasks/task.model';
import { Project } from '../../features/project/project.model';
import { Tag } from '../../features/tag/tag.model';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { SearchItem } from './search-page.model';

// Minimal stub task matching the Task interface shape
const createTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'task-1',
    title: 'Test Task',
    notes: '',
    parentId: null,
    projectId: null,
    tagIds: ['tag-1'],
    issueType: null,
    timeSpentOnDay: {},
    created: 1000,
    subTaskIds: [],
    isDone: false,
    ...overrides,
  }) as Task;

const createProject = (overrides: Partial<Project> = {}): Project =>
  ({
    id: 'proj-1',
    title: 'Test Project',
    icon: 'list',
    color: '#000',
    ...overrides,
  }) as Project;

const createTag = (overrides: Partial<Tag> = {}): Tag =>
  ({
    id: 'tag-1',
    title: 'Test Tag',
    icon: 'label',
    color: '#fff',
    ...overrides,
  }) as Tag;

describe('SearchPageComponent', () => {
  let fixture: ComponentFixture<SearchPageComponent>;
  let component: SearchPageComponent;

  let allTasks$: BehaviorSubject<Task[]>;
  let archivedTasks: Task[];
  let projectList$: BehaviorSubject<Project[]>;
  let tags$: BehaviorSubject<Tag[]>;

  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let navigateToTaskServiceSpy: jasmine.SpyObj<NavigateToTaskService>;

  beforeEach(async () => {
    allTasks$ = new BehaviorSubject<Task[]>([]);
    archivedTasks = [];
    projectList$ = new BehaviorSubject<Project[]>([createProject()]);
    tags$ = new BehaviorSubject<Tag[]>([createTag()]);

    taskServiceSpy = jasmine.createSpyObj('TaskService', ['getArchivedTasks'], {
      allTasks$,
    });
    taskServiceSpy.getArchivedTasks.and.callFake(() => Promise.resolve(archivedTasks));

    navigateToTaskServiceSpy = jasmine.createSpyObj('NavigateToTaskService', [
      'navigate',
    ]);
    navigateToTaskServiceSpy.navigate.and.returnValue(Promise.resolve());

    await TestBed.configureTestingModule({
      imports: [SearchPageComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        { provide: TaskService, useValue: taskServiceSpy },
        {
          provide: ProjectService,
          useValue: { list$: projectList$ },
        },
        { provide: TagService, useValue: { tags$: tags$ } },
        {
          provide: NavigateToTaskService,
          useValue: navigateToTaskServiceSpy,
        },
      ],
    })
      .overrideComponent(SearchPageComponent, {
        set: {
          template: '<input #inputEl>',
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(SearchPageComponent);
    component = fixture.componentInstance;
  });

  let latestResults: SearchItem[];

  const initAndFlush = (): void => {
    component.ngOnInit();
    // Subscribe early so we capture all emissions
    latestResults = [];
    component.filteredResults$.subscribe((r) => (latestResults = r));
    fixture.detectChanges();
    // Flush the archive promise (microtask)
    tick();
  };

  const typeAndFlush = (term: string): void => {
    component.searchForm.setValue(term);
    tick(150);
  };

  // --- Behavioral tests ---

  it('should return empty array for empty search', fakeAsync(() => {
    initAndFlush();
    typeAndFlush('');
    expect(latestResults).toEqual([]);
  }));

  it('should return empty array for whitespace-only search', fakeAsync(() => {
    initAndFlush();
    typeAndFlush('   ');
    expect(latestResults).toEqual([]);
  }));

  it('should find tasks by title (case-insensitive)', fakeAsync(() => {
    allTasks$.next([createTask({ id: 't1', title: 'Buy Groceries' })]);
    initAndFlush();
    typeAndFlush('buy');
    expect(latestResults.length).toBe(1);
    expect(latestResults[0].id).toBe('t1');
  }));

  it('should find tasks by notes (case-insensitive)', fakeAsync(() => {
    allTasks$.next([
      createTask({ id: 't1', title: 'My Task', notes: 'Remember to call Bob' }),
    ]);
    initAndFlush();
    typeAndFlush('BOB');
    expect(latestResults.length).toBe(1);
    expect(latestResults[0].id).toBe('t1');
  }));

  it('should limit results to 50', fakeAsync(() => {
    const tasks = Array.from({ length: 60 }, (_, i) =>
      createTask({ id: `t${i}`, title: `Match Task ${i}` }),
    );
    allTasks$.next(tasks);
    initAndFlush();
    typeAndFlush('Match');
    expect(latestResults.length).toBe(50);
  }));

  it('should debounce search by 150ms', fakeAsync(() => {
    allTasks$.next([createTask({ id: 't1', title: 'Hello World' })]);
    initAndFlush();

    component.searchForm.setValue('Hello');
    tick(100); // before debounce fires
    expect(latestResults).toEqual([]); // debounce hasn't fired yet

    tick(50); // now 150ms total
    expect(latestResults.length).toBe(1);
  }));

  it('should resolve subtask tagId from parent task', fakeAsync(() => {
    const parent = createTask({
      id: 'parent-1',
      title: 'Parent',
      tagIds: ['tag-parent'],
    });
    const child = createTask({
      id: 'child-1',
      title: 'Child Task',
      parentId: 'parent-1',
      tagIds: [],
    });
    tags$.next([createTag({ id: 'tag-parent', title: 'Parent Tag', icon: 'star' })]);
    allTasks$.next([parent, child]);
    initAndFlush();
    typeAndFlush('Child');
    expect(latestResults.length).toBe(1);
    expect(latestResults[0].tagId).toBe('tag-parent');
  }));

  it('should use project context for tasks with projectId', fakeAsync(() => {
    projectList$.next([createProject({ id: 'proj-1', title: 'My Project' })]);
    allTasks$.next([
      createTask({ id: 't1', title: 'Project Task', projectId: 'proj-1' }),
    ]);
    initAndFlush();
    typeAndFlush('Project');
    expect(latestResults.length).toBe(1);
    expect(latestResults[0].ctx.title).toBe('My Project');
  }));

  it('should use tag context for tasks without projectId', fakeAsync(() => {
    tags$.next([createTag({ id: 'tag-1', title: 'My Tag', icon: 'label' })]);
    allTasks$.next([
      createTask({
        id: 't1',
        title: 'Tag Task',
        projectId: '',
        tagIds: ['tag-1'],
      }),
    ]);
    initAndFlush();
    typeAndFlush('Tag');
    expect(latestResults.length).toBe(1);
    expect(latestResults[0].ctx.title).toBe('My Tag');
  }));

  it('should mark archive tasks with isArchiveTask=true', fakeAsync(() => {
    // Must set archive tasks before creating a new component instance,
    // because _searchableItems$ calls getArchivedTasks() at construction time.
    const archiveTask = createTask({ id: 'archived-1', title: 'Old Task' });
    taskServiceSpy.getArchivedTasks.and.returnValue(Promise.resolve([archiveTask]));
    // Recreate component so the new archive promise is used
    fixture = TestBed.createComponent(SearchPageComponent);
    component = fixture.componentInstance;
    initAndFlush();
    typeAndFlush('Old');
    expect(latestResults.length).toBe(1);
    expect(latestResults[0].isArchiveTask).toBe(true);
  }));

  it('should call NavigateToTaskService.navigate on navigateToItem', () => {
    const item = {
      id: 'nav-1',
      isArchiveTask: true,
    } as SearchItem;
    component.navigateToItem(item);
    expect(navigateToTaskServiceSpy.navigate).toHaveBeenCalledWith('nav-1', true);
  });

  it('should reset form value on clearSearch', fakeAsync(() => {
    initAndFlush();
    component.searchForm.setValue('something');
    component.clearSearch();
    expect(component.searchForm.value).toBe('');
  }));

  it('should handle missing parent gracefully', fakeAsync(() => {
    // Child references a parent that is NOT in the tasks array
    const child = createTask({
      id: 'orphan-1',
      title: 'Orphan Child',
      parentId: 'nonexistent-parent',
      tagIds: ['tag-1'],
    });
    allTasks$.next([child]);
    initAndFlush();
    typeAndFlush('Orphan');
    expect(latestResults.length).toBe(1);
    // Should fall back to own tagIds instead of crashing
    expect(latestResults[0].tagId).toBe('tag-1');
  }));

  it('should handle missing context gracefully with fallback icon', fakeAsync(() => {
    // Task references a project that doesn't exist
    allTasks$.next([
      createTask({
        id: 't1',
        title: 'Lost Task',
        projectId: 'nonexistent-project',
      }),
    ]);
    projectList$.next([]);
    initAndFlush();
    typeAndFlush('Lost');
    expect(latestResults.length).toBe(1);
    expect(latestResults[0].ctx.icon).toBe('help_outline');
  }));

  it('should not crash when task.tagIds is undefined', fakeAsync(() => {
    allTasks$.next([
      createTask({ id: 't1', title: 'No Tags Task', tagIds: undefined as any }),
    ]);
    initAndFlush();
    typeAndFlush('No Tags');
    expect(latestResults.length).toBe(1);
    expect(latestResults[0].tagId).toBeUndefined();
  }));

  it('should not crash when parent.tagIds is undefined', fakeAsync(() => {
    const parent = createTask({
      id: 'parent-1',
      title: 'Parent',
      tagIds: undefined as any,
    });
    const child = createTask({
      id: 'child-1',
      title: 'Child Bad Parent',
      parentId: 'parent-1',
      tagIds: ['tag-1'],
    });
    allTasks$.next([parent, child]);
    initAndFlush();
    typeAndFlush('Child Bad');
    expect(latestResults.length).toBe(1);
    expect(latestResults[0].tagId).toBeUndefined();
  }));

  // --- Optimization-specific tests ---

  it('should include searchText on SearchItem (pre-computed lowercase)', fakeAsync(() => {
    allTasks$.next([createTask({ id: 't1', title: 'Hello World', notes: 'Some Notes' })]);
    initAndFlush();
    typeAndFlush('hello');
    expect(latestResults.length).toBe(1);
    expect(latestResults[0].searchText).toBeDefined();
    expect(latestResults[0].searchText).toContain('hello world');
    expect(latestResults[0].searchText).toContain('some notes');
  }));
});
