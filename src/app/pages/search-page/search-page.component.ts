import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  OnInit,
  viewChild,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { T } from '../../t.const';
import { ReactiveFormsModule, UntypedFormControl } from '@angular/forms';
import { combineLatest, Observable } from 'rxjs';
import { debounceTime, filter, map, startWith } from 'rxjs/operators';
import { TaskService } from '../../features/tasks/task.service';
import { DEFAULT_TAG, TODAY_TAG } from '../../features/tag/tag.const';
import { NoteService } from '../../features/note/note.service';
import { Note } from '../../features/note/note.model';
import { Router } from '@angular/router';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { Project } from '../../features/project/project.model';
import { Tag } from '../../features/tag/tag.model';
import { ProjectService } from '../../features/project/project.service';
import { TagService } from '../../features/tag/tag.service';
import { Task } from '../../features/tasks/task.model';
import { resolveDisplayTagIds } from '../../features/tasks/util/resolve-display-tag-ids.util';
import { SearchItem } from './search-page.model';
import { NavigateToTaskService } from '../../core-ui/navigate-to-task/navigate-to-task.service';
import { AsyncPipe } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatInput } from '@angular/material/input';
import { IssueIconPipe } from '../../features/issue/issue-icon/issue-icon.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { TagComponent } from '../../features/tag/tag/tag.component';
import { MatList, MatListItem } from '@angular/material/list';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatDialog } from '@angular/material/dialog';
import { DialogViewArchivedTaskComponent } from '../../features/tasks/dialog-view-archived-task/dialog-view-archived-task.component';
import { Log } from '../../core/log';
import { MenuTreeService } from '../../features/menu-tree/menu-tree.service';
import { MatCheckbox } from '@angular/material/checkbox';

const MAX_RESULTS = 50;

@Component({
  selector: 'search-page',
  templateUrl: './search-page.component.html',
  styleUrls: ['./search-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncPipe,
    MatIcon,
    ReactiveFormsModule,
    MatIconButton,
    MatInput,
    IssueIconPipe,
    TranslatePipe,
    TagComponent,
    MatList,
    MatListItem,
    MatFormField,
    MatLabel,
    MatCheckbox,
  ],
})
export class SearchPageComponent implements OnInit {
  private _taskService = inject(TaskService);
  private _projectService = inject(ProjectService);
  private _tagService = inject(TagService);
  private _navigateToTaskService = inject(NavigateToTaskService);
  private _matDialog = inject(MatDialog);
  private _noteService = inject(NoteService);
  private _router = inject(Router);
  private _layoutService = inject(LayoutService);
  private _menuTreeService = inject(MenuTreeService);

  readonly inputEl = viewChild.required<ElementRef>('inputEl');

  T: typeof T = T;
  searchForm: UntypedFormControl = new UntypedFormControl('');
  includeCompletedForm: UntypedFormControl = new UntypedFormControl(false);
  filteredResults$: Observable<SearchItem[]> = new Observable();

  private _cachedArchiveItems: SearchItem[] | null = null;
  private _archiveCacheInputs?: {
    archiveTasks: Task[];
    projects: Project[];
    tags: Tag[];
    projectFolderMap: Map<string, string>;
    tagFolderMap: Map<string, string>;
  };

  private _searchableItems$: Observable<SearchItem[]> = combineLatest([
    this._taskService.allTasks$,
    this._taskService.getArchivedTasks(),
    this._noteService.notes$,
    this._projectService.list$,
    this._tagService.tags$,
    toObservable(this._menuTreeService.projectFolderMap),
    toObservable(this._menuTreeService.tagFolderMap),
  ]).pipe(
    map(
      ([
        allTasks,
        archiveTasks,
        notes,
        projects,
        tags,
        projectFolderMap,
        tagFolderMap,
      ]) => {
        if (
          !this._cachedArchiveItems ||
          this._archiveCacheInputs?.archiveTasks !== archiveTasks ||
          this._archiveCacheInputs?.projects !== projects ||
          this._archiveCacheInputs?.tags !== tags ||
          this._archiveCacheInputs?.projectFolderMap !== projectFolderMap ||
          this._archiveCacheInputs?.tagFolderMap !== tagFolderMap
        ) {
          this._archiveCacheInputs = {
            archiveTasks,
            projects,
            tags,
            projectFolderMap,
            tagFolderMap,
          };
          this._cachedArchiveItems = this._mapTasksToSearchItems(
            true,
            archiveTasks,
            projects,
            tags,
            projectFolderMap,
            tagFolderMap,
          );
        }
        return [
          ...this._mapTasksToSearchItems(
            false,
            allTasks,
            projects,
            tags,
            projectFolderMap,
            tagFolderMap,
          ),
          ...this._mapNotesToSearchItems(notes, projects, projectFolderMap),
          ...this._cachedArchiveItems,
        ];
      },
    ),
  );

  private _mapTasksToSearchItems(
    isArchiveTask: boolean,
    tasks: Task[],
    projects: Project[],
    tags: Tag[],
    projectFolderMap: Map<string, string>,
    tagFolderMap: Map<string, string>,
  ): SearchItem[] {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const tagMap = new Map(tags.map((t) => [t.id, t]));

    return tasks.map((task) => {
      const parent = task.parentId ? taskMap.get(task.parentId) : undefined;
      const tagId = resolveDisplayTagIds(task, parent)[0];
      const taskNotes = task.notes || '';

      return {
        id: task.id,
        title: task.title,
        taskNotes,
        searchText: `${task.title}\0${taskNotes}`.toLowerCase(),
        projectId: task.projectId || null,
        parentId: task.parentId || null,
        parentTitle: parent?.title ?? null,
        tagId,
        timeSpentOnDay: task.timeSpentOnDay,
        created: task.created,
        issueType: task.issueType || null,
        ctx: this._getContextIcon(
          task,
          projectMap,
          tagMap,
          tagId,
          projectFolderMap,
          tagFolderMap,
        ),
        isArchiveTask,
        isDone: !!task.isDone,
      };
    });
  }

  private _mapNotesToSearchItems(
    notes: Note[],
    projects: Project[],
    projectFolderMap: Map<string, string>,
  ): SearchItem[] {
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    return notes.map((note) => {
      const title = note.content ? note.content.split('\n')[0] : 'Note';
      const ctx = note.projectId
        ? projectMap.get(note.projectId) || {
            ...DEFAULT_TAG,
            icon: 'comment',
            color: 'black',
          }
        : TODAY_TAG;

      let ctxTitle = ctx.title;
      if (note.projectId) {
        const folderPath = projectFolderMap.get(note.projectId);
        if (folderPath) {
          ctxTitle = `${folderPath.replace(/ › /g, ' > ')} > ${ctx.title}`;
        }
      }

      return {
        id: note.id,
        title,
        taskNotes: note.content || '',
        searchText: (note.content || '').toLowerCase(),
        projectId: note.projectId || null,
        parentId: null,
        parentTitle: null,
        tagId: note.projectId ? '' : TODAY_TAG.id,
        timeSpentOnDay: {},
        created: note.created,
        issueType: null,
        ctx: {
          ...ctx,
          title: ctxTitle,
          icon: (ctx as Tag).icon || (note.projectId && 'list') || 'comment',
        } as Tag | Project,
        isArchiveTask: false,
        isDone: false,
        isNote: true,
      };
    });
  }

  private _getContextIcon(
    task: Task,
    projectMap: Map<string, Project>,
    tagMap: Map<string, Tag>,
    tagId: string,
    projectFolderMap: Map<string, string>,
    tagFolderMap: Map<string, string>,
  ): Tag | Project {
    let context: Tag | Project | undefined = task.projectId
      ? projectMap.get(task.projectId)
      : tagMap.get(tagId);

    if (!context) {
      Log.err(`Could not find context for task: ${task.id}`);
      context = { ...DEFAULT_TAG, icon: 'help_outline', color: 'black' };
    }

    let title = context.title;
    if (task.projectId) {
      const folderPath = projectFolderMap.get(task.projectId);
      if (folderPath) {
        title = `${folderPath.replace(/ › /g, ' > ')} > ${context.title}`;
      }
    } else if (tagId && tagId !== TODAY_TAG.id) {
      const folderPath = tagFolderMap.get(tagId);
      if (folderPath) {
        title = `${folderPath.replace(/ › /g, ' > ')} > ${context.title}`;
      }
    }

    return {
      ...context,
      title,
      icon: (context as Tag).icon || (task.projectId && 'list') || null,
    };
  }

  ngOnInit(): void {
    this.filteredResults$ = combineLatest([
      this._searchableItems$,
      this.searchForm.valueChanges.pipe(startWith('')),
      this.includeCompletedForm.valueChanges.pipe(startWith(false)),
    ]).pipe(
      debounceTime(150),
      filter(([, searchTerm]) => typeof searchTerm === 'string'),
      map(([searchableItems, searchTerm, includeCompleted]) =>
        this._filter(searchableItems, searchTerm, !!includeCompleted),
      ),
    );

    // Focus the input after view init
    setTimeout(() => {
      this.inputEl().nativeElement.focus();
    }, 100);
  }

  private _filter(
    searchableItems: SearchItem[],
    searchTerm: string,
    includeCompleted: boolean,
  ): SearchItem[] {
    if (!searchTerm.trim()) {
      return [];
    }

    const lowerSearchTerm = searchTerm.toLowerCase();
    const result = searchableItems.filter(
      (task) =>
        (includeCompleted || (!task.isDone && !task.isArchiveTask)) &&
        task.searchText.includes(lowerSearchTerm),
    );

    return result.slice(0, MAX_RESULTS);
  }

  navigateToItem(item: SearchItem): void {
    if (!item) return;
    if (item.isNote) {
      const path = item.projectId
        ? `/project/${item.projectId}/tasks`
        : `/tag/TODAY/tasks`;
      this._router.navigate([path], { queryParams: { focusItem: item.id } }).then(() => {
        if (!this._layoutService.isShowNotes()) {
          this._layoutService.toggleNotes();
        }
      });
    } else {
      this._navigateToTaskService.navigate(item.id, item.isArchiveTask).then(() => {});
    }
  }

  clearSearch(): void {
    this.searchForm.setValue('');
    this.inputEl().nativeElement.focus();
  }

  async viewArchivedTaskDetails(item: SearchItem, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    let task: Task;
    try {
      task = await this._taskService.getByIdFromEverywhere(item.id, true);
    } catch (e) {
      Log.warn('Could not load archived task', e);
      return;
    }
    this._matDialog.open(DialogViewArchivedTaskComponent, {
      restoreFocus: true,
      data: { task },
    });
  }

  trackByFn(i: number, item: SearchItem): string {
    return item.id;
  }
}
