import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom, of } from 'rxjs';
import { WorkContextMenuComponent } from './work-context-menu.component';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { ProjectService } from '../../features/project/project.service';
import { TagService } from '../../features/tag/tag.service';
import { SnackService } from '../../core/snack/snack.service';
import { WorkContextMarkdownService } from '../../features/work-context/work-context-markdown.service';
import { ShareService } from '../../core/share/share.service';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { WorkContextType } from '../../features/work-context/work-context.model';

describe('WorkContextMenuComponent', () => {
  let component: WorkContextMenuComponent;
  let fixture: ComponentFixture<WorkContextMenuComponent>;
  let mockProjectService: jasmine.SpyObj<ProjectService>;
  let mockWorkContextService: { activeWorkContextId: string | undefined };
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let confirmResult$: any;
  let router: Router;

  // Finds the rendered mat-menu-item whose icon matches `iconName`.
  const menuButtonByIcon = (iconName: string): HTMLButtonElement | null => {
    const icon = Array.from(fixture.nativeElement.querySelectorAll('mat-icon')).find(
      (el) => (el as HTMLElement).textContent?.trim() === iconName,
    );
    return (icon as HTMLElement)?.closest('button') ?? null;
  };

  beforeEach(() => {
    mockProjectService = jasmine.createSpyObj('ProjectService', [
      'archive',
      'unarchive',
      'getByIdOnce$',
      'getByIdLive$',
    ]);
    mockProjectService.getByIdOnce$.and.returnValue(
      of({ id: 'project-123', title: 'Demo project' } as any),
    );
    mockProjectService.getByIdLive$.and.returnValue(
      of({ id: 'project-123', title: 'Demo project' } as any),
    );
    mockWorkContextService = { activeWorkContextId: undefined };

    const mockShareService = jasmine.createSpyObj('ShareService', ['getShareSupport']);
    mockShareService.getShareSupport.and.returnValue(Promise.resolve('none'));

    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    confirmResult$ = of(true);
    mockMatDialog.open.and.callFake(
      () => ({ afterClosed: () => confirmResult$ }) as MatDialogRef<unknown>,
    );

    TestBed.configureTestingModule({
      imports: [WorkContextMenuComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: ProjectService, useValue: mockProjectService },
        { provide: WorkContextService, useValue: mockWorkContextService },
        { provide: SnackService, useValue: { open: () => {} } },
        { provide: MatDialog, useValue: mockMatDialog },
        {
          provide: TagService,
          useValue: jasmine.createSpyObj('TagService', ['getTagById$']),
        },
        { provide: WorkContextMarkdownService, useValue: {} },
        { provide: ShareService, useValue: mockShareService },
        { provide: Store, useValue: jasmine.createSpyObj('Store', ['dispatch']) },
      ],
    });

    fixture = TestBed.createComponent(WorkContextMenuComponent);
    component = fixture.componentInstance;
    component.contextId = 'project-123';
    component.contextTypeSet = WorkContextType.PROJECT;
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.returnValue(Promise.resolve(true));
  });

  describe('archiveProject()', () => {
    it('archives after confirmation', async () => {
      await component.archiveProject();
      expect(mockMatDialog.open).toHaveBeenCalled();
      expect(mockProjectService.archive).toHaveBeenCalledWith('project-123');
    });

    it('navigates away when archiving the currently active project', async () => {
      mockWorkContextService.activeWorkContextId = 'project-123';
      await component.archiveProject();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('does not navigate when archiving a non-active project', async () => {
      mockWorkContextService.activeWorkContextId = 'other-project';
      await component.archiveProject();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('does nothing when the confirmation is cancelled', async () => {
      confirmResult$ = of(false);
      mockWorkContextService.activeWorkContextId = 'project-123';
      await component.archiveProject();
      expect(mockProjectService.archive).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('archived state', () => {
    it('detects an archived project on init', async () => {
      mockProjectService.getByIdLive$.and.returnValue(
        of({ id: 'project-123', title: 'Demo project', isArchived: true } as any),
      );
      await component.ngOnInit();
      expect(await firstValueFrom(component.isArchived$)).toBe(true);
    });

    it('stays false for a non-archived project', async () => {
      mockProjectService.getByIdLive$.and.returnValue(
        of({ id: 'project-123', title: 'Demo project', isArchived: false } as any),
      );
      await component.ngOnInit();
      expect(await firstValueFrom(component.isArchived$)).toBe(false);
    });

    it('does not look up a project when the context is a tag', async () => {
      component.contextTypeSet = WorkContextType.TAG;
      mockProjectService.getByIdLive$.calls.reset();
      await component.ngOnInit();
      expect(mockProjectService.getByIdLive$).not.toHaveBeenCalled();
      expect(await firstValueFrom(component.isArchived$)).toBe(false);
    });
  });

  describe('restoreProject()', () => {
    it('unarchives the project', async () => {
      mockProjectService.unarchive.and.returnValue(Promise.resolve());
      await component.restoreProject();
      expect(mockProjectService.unarchive).toHaveBeenCalledWith('project-123');
    });
  });

  describe('rendered archive/restore action', () => {
    it('renders Restore (and wires it up) for an archived project', () => {
      mockProjectService.getByIdLive$.and.returnValue(
        of({ id: 'project-123', isArchived: true } as any),
      );
      mockProjectService.unarchive.and.returnValue(Promise.resolve());
      fixture.detectChanges();

      expect(menuButtonByIcon('archive')).toBeNull();
      const restoreBtn = menuButtonByIcon('unarchive');
      expect(restoreBtn).toBeTruthy();

      restoreBtn!.click();
      expect(mockProjectService.unarchive).toHaveBeenCalledWith('project-123');
    });

    it('renders Archive for a non-archived project', () => {
      mockProjectService.getByIdLive$.and.returnValue(
        of({ id: 'project-123', isArchived: false } as any),
      );
      fixture.detectChanges();

      expect(menuButtonByIcon('unarchive')).toBeNull();
      expect(menuButtonByIcon('archive')).toBeTruthy();
    });
  });
});
