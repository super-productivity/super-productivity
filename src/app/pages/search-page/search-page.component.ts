import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  OnInit,
  viewChild,
} from '@angular/core';
import { T } from '../../t.const';
import { ReactiveFormsModule, UntypedFormControl } from '@angular/forms';
import { combineLatest, Observable } from 'rxjs';
import { debounceTime, filter, map, startWith, withLatestFrom } from 'rxjs/operators';
import { TaskService } from '../../features/tasks/task.service';
import { DEFAULT_TAG } from '../../features/tag/tag.const';
import { Project } from '../../features/project/project.model';
import { Tag } from '../../features/tag/tag.model';
import { ProjectService } from '../../features/project/project.service';
import { TagService } from '../../features/tag/tag.service';
import { Task } from '../../features/tasks/task.model';
import { SearchItem } from './search-page.model';
import { NavigateToTaskService } from '../../core-ui/navigate-to-task/navigate-to-task.service';
import { AsyncPipe, NgClass } from '@angular/common';
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
    NgClass,
  ],
})
export class SearchPageComponent implements OnInit {
  private _taskService = inject(TaskService);
  private _projectService = inject(ProjectService);
  private _tagService = inject(TagService);
  private _navigateToTaskService = inject(NavigateToTaskService);
  private _matDialog = inject(MatDialog);

  readonly inputEl = viewChild.required<ElementRef>('inputEl');

  T: typeof T = T;
  searchForm: UntypedFormControl = new UntypedFormControl('');
  filteredResults$: Observable<SearchItem[]> = new Observable();

  private _cachedArchiveItems: SearchItem[] | null = null;

  private _searchableItems$: Observable<SearchItem[]> = combineLatest([
    this._taskService.allTasks$,
    this._taskService.getArchivedTasks(),
  ]).pipe(
    withLatestFrom(this._projectService.list$, this._tagService.tags$),
    map(([[allTasks, archiveTasks], projects, tags]) => {
      if (!this._cachedArchiveItems) {
        this._cachedArchiveItems = this._mapTasksToSearchItems(
          true,
          archiveTasks,
          projects,
          tags,
        );
      }
      return [
        ...this._mapTasksToSearchItems(false, allTasks, projects, tags),
        ...this._cachedArchiveItems,
      ];
    }),
  );

  private _mapTasksToSearchItems(
    isArchiveTask: boolean,
    tasks: Task[],
    projects: Project[],
    tags: Tag[],
  ): SearchItem[] {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const tagMap = new Map(tags.map((t) => [t.id, t]));

    return tasks.map((task) => {
      // By design subtasks cannot have tags.
      // If a subtask does not belong to a project, it will neither have a project nor a tag.
      // Therefore, we need to use the parent's tag.
      const parent = task.parentId ? taskMap.get(task.parentId) : undefined;
      const tagId = parent ? parent.tagIds[0] : task.tagIds[0];
      const taskNotes = task.notes || '';

      return {
        id: task.id,
        title: task.title,
        taskNotes,
        searchText: `${task.title}\0${taskNotes}`.toLowerCase(),
        projectId: task.projectId || null,
        parentId: task.parentId || null,
        tagId,
        timeSpentOnDay: task.timeSpentOnDay,
        created: task.created,
        issueType: task.issueType || null,
        ctx: this._getContextIcon(task, projectMap, tagMap, tagId),
        isArchiveTask,
      };
    });
  }

  private _getContextIcon(
    task: Task,
    projectMap: Map<string, Project>,
    tagMap: Map<string, Tag>,
    tagId: string,
  ): Tag | Project {
    let context: Tag | Project | undefined = task.projectId
      ? projectMap.get(task.projectId)
      : tagMap.get(tagId);

    if (!context) {
      Log.err(`Could not find context for task: ${task.title}`);
      context = { ...DEFAULT_TAG, icon: 'help_outline', color: 'black' };
    }

    return {
      ...context,
      icon: (context as Tag).icon || (task.projectId && 'list') || null,
    };
  }

  ngOnInit(): void {
    this.filteredResults$ = combineLatest([
      this._searchableItems$,
      this.searchForm.valueChanges.pipe(startWith('')),
    ]).pipe(
      debounceTime(150),
      filter(([searchableItems, searchTerm]) => typeof searchTerm === 'string'),
      map(([searchableItems, searchTerm]) => this._filter(searchableItems, searchTerm)),
    );

    // Focus the input after view init
    setTimeout(() => {
      this.inputEl().nativeElement.focus();
    }, 100);
  }

  private _filter(searchableItems: SearchItem[], searchTerm: string): SearchItem[] {
    if (!searchTerm.trim()) {
      return [];
    }

    const lowerSearchTerm = searchTerm.toLowerCase();
    const result = searchableItems.filter((task) =>
      task.searchText.includes(lowerSearchTerm),
    );

    return result.slice(0, MAX_RESULTS);
  }

  navigateToItem(item: SearchItem): void {
    if (!item) return;
    this._navigateToTaskService.navigate(item.id, item.isArchiveTask).then(() => {});
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
