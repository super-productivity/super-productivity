import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { WorkContextMenuComponent } from './work-context-menu.component';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { ProjectService } from '../../features/project/project.service';
import { TagService } from '../../features/tag/tag.service';
import { SnackService } from '../../core/snack/snack.service';
import { WorkContextMarkdownService } from '../../features/work-context/work-context-markdown.service';
import { ShareService } from '../../core/share/share.service';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { T } from '../../t.const';
import { WorkContextType } from '../../features/work-context/work-context.model';

describe('WorkContextMenuComponent', () => {
  let component: WorkContextMenuComponent;
  let mockProjectService: jasmine.SpyObj<ProjectService>;
  let mockWorkContextService: { activeWorkContextId: string | undefined };
  let router: Router;
  let mockSnackService: jasmine.SpyObj<SnackService>;

  beforeEach(() => {
    mockProjectService = jasmine.createSpyObj('ProjectService', [
      'archive',
      'getByIdOnce$',
    ]);
    mockWorkContextService = { activeWorkContextId: undefined };
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);

    const mockShareService = jasmine.createSpyObj('ShareService', ['getShareSupport']);
    mockShareService.getShareSupport.and.returnValue(Promise.resolve('none'));

    TestBed.configureTestingModule({
      imports: [WorkContextMenuComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: ProjectService, useValue: mockProjectService },
        { provide: WorkContextService, useValue: mockWorkContextService },
        { provide: SnackService, useValue: mockSnackService },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        {
          provide: TagService,
          useValue: jasmine.createSpyObj('TagService', ['getTagById$']),
        },
        { provide: WorkContextMarkdownService, useValue: {} },
        { provide: ShareService, useValue: mockShareService },
        { provide: Store, useValue: jasmine.createSpyObj('Store', ['dispatch']) },
      ],
    });

    const fixture = TestBed.createComponent(WorkContextMenuComponent);
    component = fixture.componentInstance;
    component.contextId = 'project-123';
    component.contextTypeSet = WorkContextType.PROJECT;
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.returnValue(Promise.resolve(true));
  });

  describe('archiveProject()', () => {
    it('should call projectService.archive with the current contextId', async () => {
      await component.archiveProject();
      expect(mockProjectService.archive).toHaveBeenCalledWith('project-123');
    });

    it('should show a snack notification after archiving', async () => {
      await component.archiveProject();
      expect(mockSnackService.open).toHaveBeenCalledWith(T.F.PROJECT.S.ARCHIVED);
    });

    it('should navigate away when archiving the currently active project', async () => {
      mockWorkContextService.activeWorkContextId = 'project-123';
      await component.archiveProject();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('should NOT navigate when archiving a non-active project', async () => {
      mockWorkContextService.activeWorkContextId = 'other-project';
      await component.archiveProject();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('should still archive even when no project is active', async () => {
      mockWorkContextService.activeWorkContextId = undefined;
      await component.archiveProject();
      expect(mockProjectService.archive).toHaveBeenCalledWith('project-123');
      expect(mockSnackService.open).toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });
});
