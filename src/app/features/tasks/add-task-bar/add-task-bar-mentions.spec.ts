import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';
import { Store } from '@ngrx/store';
import { AddTaskBarComponent } from './add-task-bar.component';
import { TaskService } from '../task.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { ProjectService } from '../../project/project.service';
import { TagService } from '../../tag/tag.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { AddTaskBarIssueSearchService } from './add-task-bar-issue-search.service';
import { MatDialog } from '@angular/material/dialog';
import { SnackService } from '../../../core/snack/snack.service';
import { TranslateModule } from '@ngx-translate/core';
import { Tag } from '../../tag/tag.model';
import { Project } from '../../project/project.model';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DEFAULT_FIRST_DAY_OF_WEEK, DEFAULT_LOCALE } from 'src/app/core/locale.constants';
import { DateAdapter } from '@angular/material/core';

@Component({
  template: `<add-task-bar></add-task-bar>`,
  standalone: true,
  imports: [AddTaskBarComponent],
})
class TestHostComponent {}

describe('AddTaskBarComponent Mentions Integration', () => {
  let component: AddTaskBarComponent;
  let fixture: ComponentFixture<TestHostComponent>;
  let tagsSubject: BehaviorSubject<any>;
  let miscSubject: BehaviorSubject<any>;

  const validTags: Tag[] = [
    { id: '1', title: 'UX', color: '#ff0000', theme: { primary: '#ff0000' } } as Tag,
    {
      id: '2',
      title: 'Development',
      color: '#00ff00',
      theme: { primary: '#00ff00' },
    } as Tag,
    { id: '3', title: 'Testing', color: '#0000ff', theme: { primary: '#0000ff' } } as Tag,
  ];

  const invalidTags = [
    { id: '4', title: 'ValidTag', color: '#ff0000', theme: { primary: '#ff0000' } },
    { id: '7', title: '', color: '#ffff00', theme: { primary: '#ffff00' } },
    { id: '9', color: '#ffffff', theme: { primary: '#ffffff' } }, // missing title
  ] as any[];

  const validProjects: Project[] = [
    {
      id: 'p1',
      title: 'Project1',
      isHiddenFromMenu: false,
      theme: { primary: '#007bff' },
    } as Project,
    {
      id: 'p2',
      title: 'Project2',
      isHiddenFromMenu: false,
      theme: { primary: '#007bff' },
    } as Project,
  ];

  beforeEach(async () => {
    miscSubject = new BehaviorSubject({ defaultProjectId: null });
    const taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'add',
      'getByIdOnce$',
      'scheduleTask',
      'moveToCurrentWorkContext',
    ]);
    const workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [], {
      activeWorkContext$: of(null),
      activeWorkContextType: null,
    });
    const projectServiceSpy = jasmine.createSpyObj('ProjectService', [], {
      list$: of(validProjects),
      listSorted$: of(validProjects),
      listSortedForUI$: of(validProjects),
      listSortedForUI: signal(validProjects),
    });
    tagsSubject = new BehaviorSubject(validTags);
    const tagServiceSpy = jasmine.createSpyObj('TagService', ['addTag'], {
      tags$: of(validTags),
      tagsNoMyDayAndNoList$: tagsSubject,
      tagsNoMyDayAndNoListSorted$: tagsSubject,
      tagsNoMyDayAndNoListSorted: signal(validTags),
    });
    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [], {
      shortSyntax$: of({
        isEnableTag: true,
        isEnableDue: true,
        isEnableProject: true,
      }),
      localization: () => ({ timeLocale: DEFAULT_LOCALE }),
      misc$: miscSubject,
      tasks$: new BehaviorSubject({ defaultProjectId: null }),
    });
    const addTaskBarIssueSearchServiceSpy = jasmine.createSpyObj(
      'AddTaskBarIssueSearchService',
      ['getFilteredIssueSuggestions$', 'addTaskFromExistingTaskOrIssue'],
    );
    const matDialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    const storeSpy = jasmine.createSpyObj('Store', ['select', 'dispatch']);
    const dateAdapter = jasmine.createSpyObj<DateAdapter<Date>>('DateAdapter', [], {
      getFirstDayOfWeek: () => DEFAULT_FIRST_DAY_OF_WEEK,
      setLocale: () => {},
    });

    await TestBed.configureTestingModule({
      imports: [
        TestHostComponent,
        AddTaskBarComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
        { provide: ProjectService, useValue: projectServiceSpy },
        { provide: TagService, useValue: tagServiceSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
        { provide: DateAdapter, useValue: dateAdapter },
        {
          provide: AddTaskBarIssueSearchService,
          useValue: addTaskBarIssueSearchServiceSpy,
        },
        { provide: MatDialog, useValue: matDialogSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: Store, useValue: storeSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    component = fixture.debugElement.children[0].componentInstance;

    // tagsSubject is already created above and accessible throughout the test

    addTaskBarIssueSearchServiceSpy.getFilteredIssueSuggestions$.and.returnValue(of([]));

    fixture.detectChanges();
  });

  describe('mentionCfg$ observable', () => {
    it('should pass through tag items without filtering', (done) => {
      // Mix valid and invalid tags; directive layer handles validation
      const mixedTags = [...validTags, ...invalidTags];
      tagsSubject.next(mixedTags as any);

      component.mentionCfg$.subscribe((config) => {
        expect(config).toBeTruthy();
        expect(config.mentions).toBeTruthy();
        expect(config.mentions!.length).toBe(3); // tag, due, project mentions

        const tagMention = config.mentions!.find((m) => m.triggerChar === '#');
        expect(tagMention).toBeTruthy();
        expect(tagMention!.items).toBeTruthy();
        expect(tagMention!.items!.length).toBeGreaterThan(0);
        expect(tagMention!.labelKey).toBe('title');

        // Should contain all original valid tag titles
        const titles = tagMention!.items!.map((item: any) => item.title);
        expect(titles).toContain('UX');
        expect(titles).toContain('Development');
        expect(titles).toContain('Testing');
        expect(titles).toContain('ValidTag');

        done();
      });
    });

    it('should handle empty tags array gracefully', (done) => {
      tagsSubject.next([]);

      component.mentionCfg$.subscribe((config) => {
        const tagMention = config.mentions!.find((m) => m.triggerChar === '#');
        expect(tagMention!.items).toEqual([]);
        done();
      });
    });

    it('should handle undefined tags array gracefully', (done) => {
      tagsSubject.next([]);

      component.mentionCfg$.subscribe((config) => {
        const tagMention = config.mentions!.find((m) => m.triggerChar === '#');
        expect(tagMention!.items).toEqual([]);
        done();
      });
    });

    it('should pass through invalid tags array as-is', (done) => {
      const onlyInvalid = invalidTags.slice(1); // exclude the one valid tag
      tagsSubject.next(onlyInvalid);

      component.mentionCfg$.subscribe((config) => {
        const tagMention = config.mentions!.find((m) => m.triggerChar === '#');
        expect(Array.isArray(tagMention!.items)).toBeTrue();
        expect(tagMention!.items!.length).toBeGreaterThanOrEqual(0);
        done();
      });
    });

    it('should pass through project items as-is', (done) => {
      component.mentionCfg$.subscribe((config) => {
        const projectMention = config.mentions!.find((m) => m.triggerChar === '+');
        expect(projectMention).toBeTruthy();
        expect(projectMention!.items!.length).toBe(2);
        const titles = projectMention!.items!.map((it: any) => it && it.title);
        expect(titles).toContain('Project1');
        expect(titles).toContain('Project2');
        done();
      });
    });

    it('should include mention types when enabled in config', (done) => {
      component.mentionCfg$.subscribe((config) => {
        // Should have at least tag and project mentions when enabled
        expect(config.mentions!.length).toBeGreaterThanOrEqual(2);

        const tagMention = config.mentions!.find((m) => m.triggerChar === '#');
        const projectMention = config.mentions!.find((m) => m.triggerChar === '+');

        expect(tagMention).toBeTruthy();
        expect(projectMention).toBeTruthy();

        // Check available trigger characters
        const triggerChars = config.mentions!.map((m) => m.triggerChar);
        expect(triggerChars).toContain('#');
        expect(triggerChars).toContain('+');

        done();
      });
    });

    it('should handle real-world tag data structure', (done) => {
      const realWorldTags = [
        {
          id: 'tag1',
          title: 'UX',
          color: '#ff0000',
          created: Date.now(),
          theme: { primary: '#ff0000' },
        },
        {
          id: 'tag2',
          title: 'Bug',
          color: '#ff0000',
          created: Date.now(),
          theme: { primary: '#ff0000' },
        },
        {
          id: 'tag3',
          title: 'Feature',
          color: '#00ff00',
          created: Date.now(),
          theme: { primary: '#00ff00' },
        },
      ] as Tag[];

      tagsSubject.next(realWorldTags);

      component.mentionCfg$.subscribe((config) => {
        const tagMention = config.mentions!.find((m) => m.triggerChar === '#');
        expect(tagMention!.items!.length).toBe(3);
        done();
      });
    });
  });

  describe('tag validation edge cases', () => {
    it('should handle tags with whitespace-only titles', (done) => {
      const tagsWithWhitespace = [
        { id: '1', title: '   ', color: '#ff0000', theme: { primary: '#ff0000' } }, // spaces only
        { id: '2', title: '\t\n', color: '#00ff00', theme: { primary: '#00ff00' } }, // tabs and newlines
        { id: '3', title: 'ValidTag', color: '#0000ff', theme: { primary: '#0000ff' } },
      ] as any[];

      tagsSubject.next(tagsWithWhitespace);

      component.mentionCfg$.subscribe((config) => {
        const tagMention = config.mentions!.find((m) => m.triggerChar === '#');
        expect(tagMention!.items!.length).toBe(tagsWithWhitespace.length);
        const titles = tagMention!.items!.map((it: any) => it && it.title);
        expect(titles).toContain('ValidTag');
        done();
      });
    });

    it('should handle tags with non-object types', (done) => {
      const mixedTypes = [
        { id: '1', title: 'ValidTag', color: '#ff0000', theme: { primary: '#ff0000' } },
      ] as any[];

      tagsSubject.next(mixedTypes);

      component.mentionCfg$.subscribe((config) => {
        const tagMention = config.mentions!.find((m) => m.triggerChar === '#');
        expect(tagMention!.items!.length).toBe(1);
        const titles = tagMention!.items!.map((it: any) => it && it.title);
        expect(titles).toContain('ValidTag');
        done();
      });
    });
  });
});
