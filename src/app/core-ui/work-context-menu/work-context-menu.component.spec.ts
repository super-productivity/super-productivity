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
      'complete',
      'reopen',
      'getCompletionInfo',
      'moveTasksToInbox',
      'markTasksDone',
      'getByIdOnce$',
      'getByIdLive$',
    ]);
    mockProjectService.getByIdOnce$.and.returnValue(
      of({ id: 'project-123', title: 'Demo project' } as any),
    );
    // Default: nothing unfinished → completion skips the resolve prompt.
    mockProjectService.getCompletionInfo.and.returnValue(
      Promise.resolve({ topLevelTasks: [], allTasks: [], undoneTopLevelTasks: [] }),
    );
    mockProjectService.moveTasksToInbox.and.returnValue(Promise.resolve());
    mockProjectService.markTasksDone.and.returnValue(Promise.resolve());
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

  describe('completeProject()', () => {
    const undoneInfo = {
      topLevelTasks: [{ id: 't1', isDone: false } as any],
      allTasks: [{ id: 't1', isDone: false } as any],
      undoneTopLevelTasks: [{ id: 't1', isDone: false } as any],
    };

    it('completes the project and navigates away when it is active', async () => {
      mockWorkContextService.activeWorkContextId = 'project-123';
      await component.completeProject();
      expect(mockProjectService.complete).toHaveBeenCalledWith(
        'project-123',
        jasmine.any(Number),
      );
      expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('does not navigate when completing a non-active project', async () => {
      mockWorkContextService.activeWorkContextId = 'other-project';
      await component.completeProject();
      expect(mockProjectService.complete).toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('moves unfinished tasks to the Inbox when chosen, then completes', async () => {
      mockProjectService.getCompletionInfo.and.returnValue(Promise.resolve(undoneInfo));
      confirmResult$ = of('inbox');
      await component.completeProject();
      expect(mockProjectService.moveTasksToInbox).toHaveBeenCalled();
      expect(mockProjectService.complete).toHaveBeenCalled();
    });

    it('aborts without completing when the unfinished-task prompt is cancelled', async () => {
      mockProjectService.getCompletionInfo.and.returnValue(Promise.resolve(undoneInfo));
      confirmResult$ = of(undefined);
      await component.completeProject();
      expect(mockProjectService.complete).not.toHaveBeenCalled();
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

    it('renders Complete (not Archive) for a non-archived project', () => {
      mockProjectService.getByIdLive$.and.returnValue(
        of({ id: 'project-123', isArchived: false } as any),
      );
      fixture.detectChanges();

      expect(menuButtonByIcon('unarchive')).toBeNull();
      // Archive was removed from the menu — Complete is the single retire path.
      expect(menuButtonByIcon('archive')).toBeNull();
      expect(menuButtonByIcon('check_circle')).toBeTruthy();
    });
  });
});
