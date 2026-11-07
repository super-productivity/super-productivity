import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { ArchivedProjectsPageComponent } from './archived-projects-page.component';
import { ProjectService } from '../../features/project/project.service';
import { Project } from '../../features/project/project.model';
import { selectArchivedProjectsSortedByTitle } from '../../features/project/store/project.selectors';
import { signal } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import localeSv from '@angular/common/locales/sv';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';

registerLocaleData(localeDe, 'de');
registerLocaleData(localeSv, 'sv');

const makeProject = (id: string, title: string, over: Partial<Project> = {}): Project =>
  ({
    id,
    title,
    isArchived: true,
    isHiddenFromMenu: false,
    theme: { primary: '#fff' },
    ...over,
  }) as unknown as Project;

describe('ArchivedProjectsPageComponent', () => {
  let fixture: ComponentFixture<ArchivedProjectsPageComponent>;
  let component: ArchivedProjectsPageComponent;
  let projectService: jasmine.SpyObj<ProjectService>;

  const setUp = async (projects: Project[]): Promise<void> => {
    projectService = jasmine.createSpyObj('ProjectService', ['unarchive', 'reopen']);

    await TestBed.configureTestingModule({
      imports: [
        ArchivedProjectsPageComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideRouter([]),
        provideMockStore({
          selectors: [{ selector: selectArchivedProjectsSortedByTitle, value: projects }],
        }),
        { provide: ProjectService, useValue: projectService },
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: signal('sv'), textLocale: signal('de') },
        },
      ],
    }).compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('en', {
      F: { PROJECT: { COMPLETE: { COMPLETED_ON: 'Completed {{date}}' } } },
    });
    translateService.use('en');

    fixture = TestBed.createComponent(ArchivedProjectsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  it('renders the empty state when there are no archived projects', async () => {
    await setUp([]);
    const empty = fixture.debugElement.query(By.css('.empty-state'));
    expect(empty).not.toBeNull();
    expect(fixture.debugElement.query(By.css('.project-list'))).toBeNull();
  });

  it('renders one row per archived project, alphabetised by the selector', async () => {
    await setUp([makeProject('p-a', 'Alpha'), makeProject('p-b', 'Beta')]);
    const rows = fixture.debugElement.queryAll(By.css('.project-row'));
    expect(rows.length).toBe(2);
    expect(rows[0].nativeElement.textContent).toContain('Alpha');
    expect(rows[1].nativeElement.textContent).toContain('Beta');
  });

  it('filters rows by the search term (case-insensitive substring)', async () => {
    await setUp([
      makeProject('p-a', 'Alpha'),
      makeProject('p-b', 'Beta'),
      makeProject('p-c', 'Gamma'),
    ]);

    component.searchTerm.set('ET');
    fixture.detectChanges();

    const rows = fixture.debugElement.queryAll(By.css('.project-row'));
    expect(rows.length).toBe(1);
    expect(rows[0].nativeElement.textContent).toContain('Beta');
  });

  it('formats the completed date in the text locale', async () => {
    await setUp([
      makeProject('p-a', 'Alpha', {
        isDone: true,
        doneOn: new Date(2026, 9, 25).getTime(),
      }),
    ]);

    const badge = fixture.debugElement.query(By.css('.completed-badge'));
    expect(badge.nativeElement.textContent).toContain('Completed 25.10.2026');
  });

  it('links each row to /project/<id>/tasks', async () => {
    await setUp([makeProject('p-a', 'Alpha')]);
    const link = fixture.debugElement.query(By.css('.project-link'));
    expect(link).not.toBeNull();
    // RouterLink directive sets the resolved href attribute.
    expect(link.nativeElement.getAttribute('href')).toBe('/project/p-a/tasks');
  });

  it('calls ProjectService.unarchive when the row button is clicked', async () => {
    await setUp([makeProject('p-a', 'Alpha')]);
    const btn = fixture.debugElement.query(By.css('.project-row button'));
    btn.nativeElement.click();
    expect(projectService.unarchive).toHaveBeenCalledWith('p-a');
  });

  it('calls ProjectService.reopen for completed projects', async () => {
    const project = makeProject('p-a', 'Alpha', { isDone: true, doneOn: 1234 });
    await setUp([project]);
    const btn = fixture.debugElement.query(By.css('.project-row button'));
    btn.nativeElement.click();
    expect(projectService.reopen).toHaveBeenCalledWith('p-a', project);
  });
});
