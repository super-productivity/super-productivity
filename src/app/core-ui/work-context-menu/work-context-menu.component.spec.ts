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
import { DialogCompleteResolveTasksComponent } from '../../features/project/dialog-complete-resolve-tasks/dialog-complete-resolve-tasks.component';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { DateService } from '../../core/date/date.service';
import { DialogProjectCompleteComponent } from '../../features/project/dialog-project-complete/dialog-project-complete.component';
import { PlainspaceShareService } from '../../features/issue/providers/plainspace/plainspace-share.service';

describe('WorkContextMenuComponent', () => {
  let component: WorkContextMenuComponent;
  let fixture: ComponentFixture<WorkContextMenuComponent>;
  let mockProjectService: jasmine.SpyObj<ProjectService>;
  let mockWorkContextService: { activeWorkContextId: string | undefined };
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockPlainspaceShareService: jasmine.SpyObj<PlainspaceShareService>;
  let resolveResult$: any;
  let confirmResult$: any;
  let isSharedOnPlainspace$: any;
  let router: Router;
  const logicalDoneOn = new Date(2026, 5, 5, 1, 0, 0).getTime();

  // Finds the rendered mat-menu-item whose icon matches `iconName`.
  const menuButtonByIcon = (iconName: string): HTMLButtonElement | null => {
    const icon = Array.from(fixture.nativeElement.querySelectorAll('mat-icon')).find(
      (el) => (el as HTMLElement).textContent?.trim() === iconName,
    );
    return (icon as HTMLElement)?.closest('button') ?? null;
  };

  beforeEach(() => {
    mockProjectService = jasmine.createSpyObj('ProjectService', [
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
      Promise.resolve({
        topLevelTasks: [],
        allTasks: [],
        unfinishedTasks: [],
        topLevelTasksWithUnfinishedWork: [],
      }),
    );
    mockProjectService.moveTasksToInbox.and.returnValue(Promise.resolve());
    mockProjectService.markTasksDone.and.returnValue(Promise.resolve());
    mockProjectService.getByIdLive$.and.returnValue(
      of({ id: 'project-123', title: 'Demo project' } as any),
    );
    mockWorkContextService = { activeWorkContextId: undefined };

    const mockShareService = jasmine.createSpyObj('ShareService', ['getShareSupport']);
    mockShareService.getShareSupport.and.returnValue(Promise.resolve('none'));

    mockPlainspaceShareService = jasmine.createSpyObj('PlainspaceShareService', [
      'shareProjectOnPlainspace',
    ]);
    mockPlainspaceShareService.shareProjectOnPlainspace.and.returnValue(
      Promise.resolve('space-1'),
    );

    // Default: project not yet shared → the Collaborate action is visible.
    isSharedOnPlainspace$ = of(false);
    const mockStore = jasmine.createSpyObj('Store', ['dispatch', 'select']);
    mockStore.select.and.callFake(() => isSharedOnPlainspace$);

    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    resolveResult$ = of(undefined);
    confirmResult$ = of(true);
    mockMatDialog.open.and.callFake((componentOrTemplateRef) => {
      if (componentOrTemplateRef === DialogCompleteResolveTasksComponent) {
        return { afterClosed: () => resolveResult$ } as MatDialogRef<unknown>;
      }
      if (componentOrTemplateRef === DialogConfirmComponent) {
        return { afterClosed: () => confirmResult$ } as MatDialogRef<unknown>;
      }
      return { afterClosed: () => of(undefined) } as MatDialogRef<unknown>;
    });

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
        { provide: Store, useValue: mockStore },
        {
          provide: PlainspaceShareService,
          useValue: mockPlainspaceShareService,
        },
        {
          provide: DateService,
          useValue: {
            getLogicalTodayDate: () => new Date(logicalDoneOn),
          },
        },
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
      unfinishedTasks: [{ id: 't1', isDone: false } as any],
      topLevelTasksWithUnfinishedWork: [{ id: 't1', isDone: false } as any],
    };

    it('completes the project and navigates away when it is active', async () => {
      mockWorkContextService.activeWorkContextId = 'project-123';
      await component.completeProject();
      expect(mockProjectService.complete).toHaveBeenCalledWith(
        'project-123',
        logicalDoneOn,
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
      resolveResult$ = of('inbox');
      await component.completeProject();
      expect(mockProjectService.moveTasksToInbox).toHaveBeenCalledWith(
        undoneInfo.topLevelTasksWithUnfinishedWork,
      );
      expect(mockProjectService.complete).toHaveBeenCalled();
      // Resolution must run BEFORE the flag flip, else the project is archived
      // while its unfinished tasks are still attached.
      expect(mockProjectService.moveTasksToInbox).toHaveBeenCalledBefore(
        mockProjectService.complete,
      );
    });

    it('resolves using the initially captured info, not a re-fetch', async () => {
      const refreshedInfo = {
        topLevelTasks: [{ id: 't2', isDone: false } as any],
        allTasks: [{ id: 't2', isDone: false } as any],
        unfinishedTasks: [{ id: 't2', isDone: false } as any],
        topLevelTasksWithUnfinishedWork: [{ id: 't2', isDone: false } as any],
      };
      // First call gates the resolve prompt; the second (post-resolution) only
      // feeds the celebration stats — it must NOT change which tasks get resolved.
      mockProjectService.getCompletionInfo.and.returnValues(
        Promise.resolve(undoneInfo),
        Promise.resolve(refreshedInfo),
      );
      resolveResult$ = of('inbox');

      await component.completeProject();

      expect(mockProjectService.moveTasksToInbox).toHaveBeenCalledWith(
        undoneInfo.topLevelTasksWithUnfinishedWork,
      );
    });

    it('recomputes completion info after resolving so stats reflect the final list', async () => {
      mockProjectService.getCompletionInfo.and.returnValue(Promise.resolve(undoneInfo));
      resolveResult$ = of('markDone');

      await component.completeProject();

      // Once to gate the prompt, once after resolution for the stats.
      expect(mockProjectService.getCompletionInfo).toHaveBeenCalledTimes(2);
    });

    it('fetches completion info only once when there is no unfinished work', async () => {
      await component.completeProject();
      expect(mockProjectService.getCompletionInfo).toHaveBeenCalledTimes(1);
    });

    it('shows an error and aborts when completion info cannot be loaded', async () => {
      spyOn(console, 'error');
      const snackSpy = spyOn(TestBed.inject(SnackService), 'open');
      mockProjectService.getCompletionInfo.and.returnValue(
        Promise.reject(new Error('archive load failed')),
      );

      await component.completeProject();

      expect(mockProjectService.complete).not.toHaveBeenCalled();
      expect(snackSpy).toHaveBeenCalled();
    });

    it('marks all unfinished tasks done when chosen, then completes', async () => {
      mockProjectService.getCompletionInfo.and.returnValue(Promise.resolve(undoneInfo));
      resolveResult$ = of('markDone');
      await component.completeProject();
      expect(mockProjectService.markTasksDone).toHaveBeenCalledWith(
        undoneInfo.unfinishedTasks,
      );
      expect(mockProjectService.complete).toHaveBeenCalled();
      // Resolution must run BEFORE the flag flip.
      expect(mockProjectService.markTasksDone).toHaveBeenCalledBefore(
        mockProjectService.complete,
      );
    });

    it('does not move unfinished tasks when Inbox is chosen but confirmation is cancelled', async () => {
      mockProjectService.getCompletionInfo.and.returnValue(Promise.resolve(undoneInfo));
      resolveResult$ = of('inbox');
      confirmResult$ = of(false);

      await component.completeProject();

      expect(mockProjectService.complete).not.toHaveBeenCalled();
      expect(
        mockMatDialog.open.calls
          .allArgs()
          .some((args) => args[0] === DialogProjectCompleteComponent),
      ).toBe(false);
    });

    it('does not mark unfinished tasks done when chosen but confirmation is cancelled', async () => {
      mockProjectService.getCompletionInfo.and.returnValue(Promise.resolve(undoneInfo));
      resolveResult$ = of('markDone');
      confirmResult$ = of(false);

      await component.completeProject();

      expect(mockProjectService.complete).not.toHaveBeenCalled();
      expect(
        mockMatDialog.open.calls
          .allArgs()
          .some((args) => args[0] === DialogProjectCompleteComponent),
      ).toBe(false);
    });

    it('aborts without completing when the unfinished-task prompt is cancelled', async () => {
      mockProjectService.getCompletionInfo.and.returnValue(Promise.resolve(undoneInfo));
      resolveResult$ = of(undefined);
      await component.completeProject();
      expect(mockProjectService.complete).not.toHaveBeenCalled();
    });

    it('asks for confirmation before completing', async () => {
      await component.completeProject();
      expect(mockMatDialog.open).toHaveBeenCalledWith(
        DialogConfirmComponent,
        jasmine.objectContaining({
          data: jasmine.objectContaining({
            message: jasmine.any(String),
          }),
        }),
      );
      expect(mockProjectService.complete).toHaveBeenCalled();
      const confirmCall = mockMatDialog.open.calls
        .all()
        .find((call) => call.args[0] === DialogConfirmComponent);
      expect((confirmCall as any)?.invocationOrder).toBeLessThan(
        (mockProjectService.complete.calls.first() as any).invocationOrder,
      );
    });

    it('opens the celebration as a fullscreen overlay', async () => {
      await component.completeProject();
      expect(mockMatDialog.open).toHaveBeenCalledWith(
        DialogProjectCompleteComponent,
        jasmine.objectContaining({
          panelClass: 'project-complete-fullscreen-dialog',
          ariaLabelledBy: 'project-complete-title',
        }),
      );
    });

    it('aborts without completing when confirmation is cancelled', async () => {
      confirmResult$ = of(false);
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
    it('renders Restore (and wires it up) for an archived project', async () => {
      mockProjectService.getByIdLive$.and.returnValue(
        of({ id: 'project-123', isArchived: true } as any),
      );
      mockProjectService.getByIdOnce$.and.returnValue(
        of({ id: 'project-123', isArchived: true, isDone: false } as any),
      );
      mockProjectService.unarchive.and.returnValue(Promise.resolve());
      fixture.detectChanges();

      expect(menuButtonByIcon('archive')).toBeNull();
      const restoreBtn = menuButtonByIcon('unarchive');
      expect(restoreBtn).toBeTruthy();

      restoreBtn!.click();
      await fixture.whenStable();
      expect(mockProjectService.unarchive).toHaveBeenCalledWith('project-123');
    });

    it('renders Reopen for a completed project', async () => {
      mockProjectService.getByIdLive$.and.returnValue(
        of({ id: 'project-123', isArchived: true, isDone: true } as any),
      );
      mockProjectService.getByIdOnce$.and.returnValue(
        of({ id: 'project-123', isArchived: true, isDone: true } as any),
      );
      fixture.detectChanges();

      const reopenBtn = menuButtonByIcon('replay');
      expect(reopenBtn).toBeTruthy();

      reopenBtn!.click();
      await fixture.whenStable();
      expect(mockProjectService.reopen).toHaveBeenCalledWith('project-123', {
        id: 'project-123',
        isArchived: true,
        isDone: true,
      } as any);
    });

    it('renders Complete but not Archive for a non-archived project', async () => {
      mockProjectService.getByIdLive$.and.returnValue(
        of({ id: 'project-123', isArchived: false } as any),
      );
      fixture.detectChanges();

      // Archive was collapsed into Complete — it's the single retire path.
      expect(menuButtonByIcon('unarchive')).toBeNull();
      expect(menuButtonByIcon('archive')).toBeNull();
      expect(menuButtonByIcon('check_circle')).toBeTruthy();
    });
  });

  describe('shareProjectOnPlainspace()', () => {
    it('provisions sharing for the project via the share service', async () => {
      mockProjectService.getByIdOnce$.and.returnValue(
        of({ id: 'project-123', title: 'Demo project' } as any),
      );
      await component.shareProjectOnPlainspace();
      expect(mockPlainspaceShareService.shareProjectOnPlainspace).toHaveBeenCalledWith(
        'project-123',
        'Demo project',
      );
    });

    it('does nothing when the project cannot be found', async () => {
      mockProjectService.getByIdOnce$.and.returnValue(of(undefined as any));
      await component.shareProjectOnPlainspace();
      expect(mockPlainspaceShareService.shareProjectOnPlainspace).not.toHaveBeenCalled();
    });
  });

  describe('rendered Collaborate-on-Plainspace action', () => {
    it('renders the action for an active, not-yet-shared project and wires it up', async () => {
      mockProjectService.getByIdLive$.and.returnValue(
        of({ id: 'project-123', isArchived: false } as any),
      );
      mockProjectService.getByIdOnce$.and.returnValue(
        of({ id: 'project-123', title: 'Demo project' } as any),
      );
      isSharedOnPlainspace$ = of(false);
      fixture.detectChanges();

      const shareBtn = menuButtonByIcon('group_add');
      expect(shareBtn).toBeTruthy();

      shareBtn!.click();
      await fixture.whenStable();
      expect(mockPlainspaceShareService.shareProjectOnPlainspace).toHaveBeenCalledWith(
        'project-123',
        'Demo project',
      );
    });

    it('hides the action once the project is already shared', async () => {
      mockProjectService.getByIdLive$.and.returnValue(
        of({ id: 'project-123', isArchived: false } as any),
      );
      isSharedOnPlainspace$ = of(true);
      fixture.detectChanges();

      expect(menuButtonByIcon('group_add')).toBeNull();
    });

    it('does not render the action for a tag context', async () => {
      component.contextTypeSet = WorkContextType.TAG;
      fixture.detectChanges();

      expect(menuButtonByIcon('group_add')).toBeNull();
    });
  });
});
