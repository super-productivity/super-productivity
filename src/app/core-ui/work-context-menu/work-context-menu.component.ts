import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  inject,
  Input,
} from '@angular/core';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { T } from 'src/app/t.const';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { MatDialog } from '@angular/material/dialog';
import { TagService } from '../../features/tag/tag.service';
import { first, map } from 'rxjs/operators';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { Router, RouterLink, RouterModule } from '@angular/router';

import {
  ProjectCompletionInfo,
  ProjectService,
} from '../../features/project/project.service';
import { Project } from '../../features/project/project.model';
import {
  getProjectCompletionStats,
  ProjectCompletionStats,
} from '../../features/project/project-completion-stats.util';
import { DialogProjectCompleteComponent } from '../../features/project/dialog-project-complete/dialog-project-complete.component';
import {
  DialogCompleteResolveTasksComponent,
  ResolveUnfinishedTasksChoice,
} from '../../features/project/dialog-complete-resolve-tasks/dialog-complete-resolve-tasks.component';
import { SectionService } from '../../features/section/section.service';
import { DialogPromptComponent } from '../../ui/dialog-prompt/dialog-prompt.component';
import { MatMenuItem } from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { MatIcon } from '@angular/material/icon';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { SnackService } from '../../core/snack/snack.service';
import { WorkContextMarkdownService } from '../../features/work-context/work-context-markdown.service';
import { ShareService, ShareSupport } from '../../core/share/share.service';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { TaskWithSubTasks } from '../../features/tasks/task.model';
import { firstValueFrom, Observable, of } from 'rxjs';
import { AsyncPipe } from '@angular/common';
import { DateService } from '../../core/date/date.service';
import { openWorkContextSettingsDialog } from '../../features/work-context/dialog-work-context-settings/open-work-context-settings-dialog';
import { Log } from '../../core/log';
import { PlainspaceShareService } from '../../features/issue/providers/plainspace/plainspace-share.service';
import { selectIsProjectSharedOnPlainspace } from '../../features/issue/store/issue-provider.selectors';

@Component({
  selector: 'work-context-menu',
  templateUrl: './work-context-menu.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterModule, MatMenuItem, TranslatePipe, MatIcon, AsyncPipe],
  standalone: true,
})
export class WorkContextMenuComponent implements OnInit {
  private _matDialog = inject(MatDialog);
  private _tagService = inject(TagService);
  private _projectService = inject(ProjectService);
  private _sectionService = inject(SectionService);
  private _workContextService = inject(WorkContextService);
  private _router = inject(Router);
  private _snackService = inject(SnackService);
  private _markdownService = inject(WorkContextMarkdownService);
  private _shareService = inject(ShareService);
  private _cd = inject(ChangeDetectorRef);
  private _store = inject(Store);
  private _dateService = inject(DateService);
  private _plainspaceShareService = inject(PlainspaceShareService);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  @Input() contextId!: string;
  T: typeof T = T;
  TODAY_TAG_ID: string = TODAY_TAG.id as string;
  isForProject: boolean = true;
  isArchived$: Observable<boolean> = of(false);
  isDone$: Observable<boolean> = of(false);
  isSharedOnPlainspace$: Observable<boolean> = of(false);
  base: string = 'project';
  shareSupport: ShareSupport = 'none';

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input('contextType') set contextTypeSet(v: WorkContextType) {
    this.isForProject = v === WorkContextType.PROJECT;
    this.base = this.isForProject ? 'project' : 'tag';
  }

  async ngOnInit(): Promise<void> {
    if (this.isForProject) {
      this.isArchived$ = this._projectService
        .getByIdLive$(this.contextId)
        .pipe(map((project) => !!project?.isArchived));
      this.isDone$ = this._projectService
        .getByIdLive$(this.contextId)
        .pipe(map((project) => !!project?.isDone));
      this.isSharedOnPlainspace$ = this._store.select(
        selectIsProjectSharedOnPlainspace(this.contextId),
      );
    }
    const support = await this._shareService.getShareSupport();
    this._setShareSupport(support);
  }

  async deleteTag(): Promise<void> {
    const tag = await this._tagService
      .getTagById$(this.contextId)
      .pipe(first())
      .toPromise();
    const isConfirmed = await this._matDialog
      .open(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          message: T.F.TAG.D_DELETE.CONFIRM_MSG,
          translateParams: { tagName: tag.title },
        },
      })
      .afterClosed()
      .toPromise();

    if (isConfirmed) {
      const activeId = this._workContextService.activeWorkContextId;
      if (activeId === this.contextId) {
        await this._router.navigateByUrl('/');
      }
      this._tagService.removeTag(this.contextId);
    }
  }

  async deleteProject(): Promise<void> {
    const project = await this._projectService.getByIdOnce$(this.contextId).toPromise();
    if (!project) {
      return;
    }
    const isConfirmed = await this._matDialog
      .open(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          message: T.F.PROJECT.D_DELETE.MSG,
          translateParams: { title: project.title },
        },
      })
      .afterClosed()
      .toPromise();

    if (isConfirmed) {
      const activeId = this._workContextService.activeWorkContextId;
      if (activeId === this.contextId) {
        await this._router.navigateByUrl('/');
      }
      this._projectService.remove(project);
    }
  }

  async completeProject(): Promise<void> {
    const project = await firstValueFrom(
      this._projectService.getByIdOnce$(this.contextId),
    );
    if (!project) {
      return;
    }

    const info = await this._getCompletionInfoOrNotify();
    if (!info) {
      return;
    }

    let resolution: ResolveUnfinishedTasksChoice | undefined;
    // Auto-archiving would otherwise bury live, undone work — ask first.
    if (info.unfinishedTasks.length) {
      resolution = await this._promptResolveUnfinishedTasks(
        project.title,
        info.unfinishedTasks.length,
      );
      if (!resolution) {
        return;
      }
    }

    if (!(await this._confirmCompletion(project.title))) {
      return;
    }

    // Resolve unfinished work via the normal per-task actions BEFORE completing,
    // so every downstream effect (issue sync, reminders, repeat-cfg) and
    // per-entity conflict detection fires naturally. Completion itself is then a
    // plain single-entity project flag flip.
    await this._applyResolution(resolution, info);

    // Recompute after resolution so the stats reflect the final task list.
    let statsInfo = info;
    if (resolution) {
      const refreshed = await this._getCompletionInfoOrNotify();
      if (!refreshed) {
        return;
      }
      statsInfo = refreshed;
    }

    const doneOn = this._dateService.getLogicalTodayDate().getTime();
    const stats = getProjectCompletionStats(
      statsInfo.topLevelTasks,
      statsInfo.allTasks,
      doneOn,
    );

    const activeId = this._workContextService.activeWorkContextId;
    this._projectService.complete(this.contextId, doneOn);

    // Navigate away BEFORE opening the celebration: MatDialog's closeOnNavigation
    // (default true) would otherwise dismiss the dialog the moment we leave the
    // now-completed project's route.
    if (activeId === this.contextId) {
      await this._router.navigateByUrl('/');
    }

    this._openCelebrationDialog(project, stats);
  }

  private async _applyResolution(
    resolution: ResolveUnfinishedTasksChoice | undefined,
    info: ProjectCompletionInfo,
  ): Promise<void> {
    if (resolution === 'inbox') {
      await this._projectService.moveTasksToInbox(info.topLevelTasksWithUnfinishedWork);
    } else if (resolution === 'markDone') {
      await this._projectService.markTasksDone(info.unfinishedTasks);
    }
  }

  private _openCelebrationDialog(project: Project, stats: ProjectCompletionStats): void {
    // Fullscreen sizing lives in the .project-complete-fullscreen-dialog
    // panelClass (handles dvh + mobile safe-areas); don't duplicate it here.
    this._matDialog.open(DialogProjectCompleteComponent, {
      restoreFocus: true,
      panelClass: 'project-complete-fullscreen-dialog',
      ariaLabelledBy: 'project-complete-title',
      data: { project, stats },
    });
  }

  private async _getCompletionInfoOrNotify(): Promise<ProjectCompletionInfo | null> {
    try {
      return await this._projectService.getCompletionInfo(this.contextId);
    } catch (err) {
      Log.err(err);
      this._snackService.open({ type: 'ERROR', msg: T.F.PROJECT.COMPLETE.ERROR });
      return null;
    }
  }

  private _promptResolveUnfinishedTasks(
    title: string,
    nr: number,
  ): Promise<ResolveUnfinishedTasksChoice | undefined> {
    return firstValueFrom(
      this._matDialog
        .open(DialogCompleteResolveTasksComponent, {
          restoreFocus: true,
          data: { title, nr },
        })
        .afterClosed(),
    );
  }

  private _confirmCompletion(title: string): Promise<boolean> {
    return firstValueFrom(
      this._matDialog
        .open(DialogConfirmComponent, {
          restoreFocus: true,
          data: {
            title: T.F.PROJECT.COMPLETE.CONFIRM.TITLE,
            titleIcon: 'check_circle',
            message: T.F.PROJECT.COMPLETE.CONFIRM.MSG,
            translateParams: { title },
            okTxt: T.MH.COMPLETE_PROJECT,
          },
        })
        .afterClosed(),
    );
  }

  async restoreProject(): Promise<void> {
    const project = await firstValueFrom(
      this._projectService.getByIdOnce$(this.contextId),
    );
    if (!project) {
      return;
    }
    if (project.isDone) {
      this._projectService.reopen(this.contextId, project);
    } else {
      await this._projectService.unarchive(this.contextId);
    }
  }

  async shareProjectOnPlainspace(): Promise<void> {
    const project = await firstValueFrom(
      this._projectService.getByIdOnce$(this.contextId),
    );
    if (!project) {
      return;
    }
    // Self-contained: prompts for sign-in + space, and surfaces its own
    // success/failure snack. Never rejects, so no try/catch needed here.
    await this._plainspaceShareService.shareProjectOnPlainspace(
      project.id,
      project.title,
    );
  }

  async duplicateProject(): Promise<void> {
    try {
      await this._projectService.duplicateProject(this.contextId);
      this._snackService.open(T.GLOBAL_SNACK.DUPLICATE_PROJECT_SUCCESS);
    } catch (err) {
      this._snackService.open({
        msg: T.GLOBAL_SNACK.DUPLICATE_PROJECT_ERROR,
        type: 'ERROR',
      });
      Log.err(err);
    }
  }

  addSection(): void {
    this._matDialog
      .open(DialogPromptComponent, {
        // Omit `message` to match the Add Tag pattern — the dialog
        // collapses its outer padding when there's no message text
        // (`dialog-prompt.scss: mat-dialog-content.isNoMsg`).
        // Use a descriptive placeholder ("Add Section") rather than a
        // generic "Title" so screen readers and visual users get the
        // dialog's purpose without a separate title element.
        data: {
          placeholder: T.WW.ADD_SECTION_TITLE,
        },
      })
      // NOTE: do NOT pipe takeUntilDestroyed here. This component lives inside
      // a <mat-menu>; the menu (and component) is destroyed the moment the
      // dialog opens, which would unsubscribe before afterClosed() emits.
      // MatDialog cleans up its own subscription when the dialog closes.
      .afterClosed()
      .subscribe((title: string) => {
        if (title?.trim()) {
          this._sectionService.addSection(
            title,
            this.contextId,
            this.isForProject ? WorkContextType.PROJECT : WorkContextType.TAG,
          );
        }
      });
  }

  protected readonly INBOX_PROJECT = INBOX_PROJECT;

  async shareTasksAsMarkdown(): Promise<void> {
    const { status, markdown, contextTitle } =
      await this._markdownService.getMarkdownForContext(
        this.contextId,
        this.isForProject,
      );

    if (status === 'empty' || !markdown) {
      this._snackService.open(T.GLOBAL_SNACK.NO_TASKS_TO_COPY);
      return;
    }

    const shareResult = await this._shareService.shareText({
      title: contextTitle ?? 'Super Productivity',
      text: markdown,
    });

    if (shareResult === 'shared') {
      if (this.shareSupport === 'none') {
        const support = await this._shareService.getShareSupport();
        this._setShareSupport(support);
      }
      return;
    }

    if (shareResult === 'cancelled') {
      return;
    }

    const didCopy = await this._markdownService.copyMarkdownText(markdown);
    if (didCopy) {
      if (shareResult === 'unavailable') {
        this._snackService.open(T.GLOBAL_SNACK.SHARE_UNAVAILABLE_FALLBACK);
        this._setShareSupport('none');
      } else if (shareResult === 'failed') {
        this._snackService.open(T.GLOBAL_SNACK.SHARE_FAILED_FALLBACK);
        this._setShareSupport('none');
      } else {
        this._snackService.open(T.GLOBAL_SNACK.COPY_TO_CLIPPBOARD);
      }
      return;
    }

    this._snackService.open({
      msg: T.GLOBAL_SNACK.SHARE_FAILED,
      type: 'ERROR',
    });
    this._setShareSupport('none');
  }

  async unplanAllTodayTasks(): Promise<void> {
    if (this.contextId !== this.TODAY_TAG_ID) {
      return;
    }

    const todayTasks = ((await this._workContextService.mainListTasks$
      .pipe(first())
      .toPromise()) || []) as TaskWithSubTasks[];
    const undoneTasks = todayTasks.filter((task) => !task.isDone);

    if (!undoneTasks.length) {
      this._snackService.open(T.GLOBAL_SNACK.NO_TASKS_TO_UNPLAN);
      return;
    }

    const scheduledTasks = undoneTasks.filter(
      (task) => !!task.dueDay || !!task.dueWithTime,
    );

    scheduledTasks.forEach((task) => {
      this._store.dispatch(
        TaskSharedActions.unscheduleTask({
          id: task.id,
          isSkipToast: true,
        }),
      );
    });

    const remainingIds = undoneTasks
      .filter((task) => !task.dueDay && !task.dueWithTime)
      .map((task) => task.id);

    if (remainingIds.length) {
      this._store.dispatch(
        TaskSharedActions.removeTasksFromTodayTag({ taskIds: remainingIds }),
      );
    }

    this._snackService.open(T.GLOBAL_SNACK.UNPLANNED_TODAY_TASKS);
  }

  async openSettings(): Promise<void> {
    try {
      const entity = this.isForProject
        ? await firstValueFrom(this._projectService.getByIdOnce$(this.contextId))
        : await firstValueFrom(
            this._tagService.getTagById$(this.contextId).pipe(first()),
          );
      if (!entity) {
        throw new Error(`Unable to find work context ${this.contextId}`);
      }

      await openWorkContextSettingsDialog(this._matDialog, {
        isProject: this.isForProject,
        entity,
      });
    } catch (err) {
      this._snackService.open({
        msg: T.GLOBAL_SNACK.OPEN_SETTINGS_ERROR,
        type: 'ERROR',
      });
      Log.err(err);
    }
  }

  private _setShareSupport(support: ShareSupport): void {
    this.shareSupport = support;
    this._cd.markForCheck();
  }
}
