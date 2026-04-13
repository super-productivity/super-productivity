import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TaskWithSubTasks } from '../../tasks/task.model';
import { IssueData, IssueProviderKey, BuiltInIssueProviderKey } from '../issue.model';
import {
  IssueContentConfig,
  IssueFieldConfig,
  IssueFieldType,
  IssueComment,
} from './issue-content.model';
import { ISSUE_CONTENT_CONFIGS } from './issue-content-configs.const';
import { TranslateModule } from '@ngx-translate/core';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MarkdownModule } from 'ngx-markdown';
import { AsyncPipe } from '@angular/common';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { TaskService } from '../../tasks/task.service';
import { expandAnimation } from '../../../ui/animations/expand.ani';
import { IssueContentCustomComponent } from './issue-content-custom/issue-content-custom.component';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { JiraToMarkdownPipe } from '../../../ui/pipes/jira-to-markdown.pipe';
import { SortPipe } from '../../../ui/pipes/sort.pipe';
import { T } from '../../../t.const';
import { devError } from '../../../util/dev-error';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';

@Component({
  selector: 'issue-content',
  templateUrl: './issue-content.component.html',
  styleUrls: ['./issue-content.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslateModule,
    MatTableModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MarkdownModule,
    AsyncPipe,
    LocaleDatePipe,
    MatProgressBarModule,
    JiraToMarkdownPipe,
    SortPipe,
    IssueContentCustomComponent,
  ],
  animations: [expandAnimation],
})
export class IssueContentComponent {
  private _taskService = inject(TaskService);
  private _pluginRegistry = inject(PluginIssueProviderRegistryService);
  protected readonly T = T;

  readonly IssueFieldType = IssueFieldType;

  task = input.required<TaskWithSubTasks>();
  issueData = input<IssueData>();

  isForceShowAllComments = signal(false);

  config = computed<IssueContentConfig | undefined>(() => {
    const issueType = this.task().issueType as IssueProviderKey;
    if (this._pluginRegistry.hasProvider(issueType)) {
      const displayFields = this._pluginRegistry.getIssueDisplay(issueType);
      const commentsCfg = this._pluginRegistry.getCommentsConfig(issueType);
      const result: IssueContentConfig = {
        issueType,
        fields: displayFields.map((f) => {
          const field: IssueFieldConfig<IssueData> = {
            label: f.label,
            type: this._mapPluginFieldType(f.type),
            value: f.field,
          };
          if (f.linkField) {
            const linkFieldName = f.linkField;
            field.getLink = (issue: IssueData): string =>
              (issue as Record<string, unknown>)[linkFieldName] as string;
          }
          if (f.hideEmpty) {
            const fieldName = f.field;
            field.isVisible = (issue: IssueData): boolean =>
              !!(issue as Record<string, unknown>)[fieldName];
          }
          return field;
        }),
      };
      if (commentsCfg) {
        result.comments = {
          field: 'comments',
          authorField: commentsCfg.authorField ?? 'author',
          bodyField: commentsCfg.bodyField ?? 'body',
          createdField: commentsCfg.createdField ?? 'created',
          avatarField: commentsCfg.avatarField,
          sortField: commentsCfg.sortField ?? commentsCfg.createdField ?? 'created',
        };
        result.hasCollapsingComments = true;
      }
      return result;
    }
    const builtInKey = issueType as BuiltInIssueProviderKey;
    if (!ISSUE_CONTENT_CONFIGS[builtInKey]) {
      return undefined;
    }
    return ISSUE_CONTENT_CONFIGS[builtInKey];
  });

  currentTask = computed(() => this.task());
  currentIssue = computed(() => this.issueData());

  visibleFields = computed(() => {
    const cfg = this.config();
    const issue = this.currentIssue();
    if (!cfg || !issue) return [];

    return cfg.fields.filter((field) =>
      field.isVisible ? field.isVisible(issue) : true,
    );
  });

  isCollapsedIssueComments = computed(() => {
    const issue = this.currentIssue();
    const config = this.config();
    return (
      !this.isForceShowAllComments() &&
      config?.hasCollapsingComments &&
      this._getCommentsArray(issue).length > 1
    );
  });

  lastComment = computed(() => {
    const issue = this.currentIssue();
    const config = this.config();
    if (!this._hasCommentsField(issue) || !config?.comments) return null;
    const comments = this._getCommentsArray(issue);
    return comments.length > 0 ? comments[comments.length - 1] : null;
  });

  hasComments = computed(() => {
    const issue = this.currentIssue();
    return this._hasCommentsField(issue) && this._getCommentsArray(issue).length > 0;
  });

  commentsLength = computed(() => {
    const issue = this.currentIssue();
    return this._getCommentsArray(issue).length;
  });

  comments = computed(() => {
    const issue = this.currentIssue();
    return this._getCommentsArray(issue);
  });

  getFieldValue(field: IssueFieldConfig<IssueData>, issue: IssueData | undefined): any {
    if (!issue) return undefined;

    try {
      if (typeof field.value === 'function') {
        return field.value(issue);
      }

      // Handle nested fields like 'status.name'
      const keys = field.value.split('.');
      let value: any = issue;
      for (const key of keys) {
        value = value?.[key];
      }
      return value;
    } catch (error) {
      devError(error);
    }
  }

  getFieldLink(field: IssueFieldConfig<IssueData>, issue: IssueData | undefined): string {
    if (!issue) return '';

    if (field.getLink) {
      return field.getLink(issue);
    }
    return '';
  }

  getCommentAuthor(comment: IssueComment | null, cfg: IssueContentConfig): string {
    if (!comment) return '';
    const keys = cfg.comments!.authorField.split('.');
    let value: any = comment;
    for (const key of keys) {
      value = value?.[key];
    }
    return value || '';
  }

  getCommentBody(comment: IssueComment | null, cfg: IssueContentConfig): string {
    if (!comment) return '';
    return comment[cfg.comments!.bodyField] || '';
  }

  getCommentCreated(comment: IssueComment | null, cfg: IssueContentConfig): string {
    if (!comment) return '';
    return comment[cfg.comments!.createdField] || '';
  }

  getCommentAvatar(
    comment: IssueComment | null,
    cfg: IssueContentConfig,
  ): string | undefined {
    if (!comment || !cfg.comments?.avatarField) return undefined;

    const keys = cfg.comments.avatarField.split('.');
    let value: any = comment;
    for (const key of keys) {
      value = value?.[key];
    }
    return value;
  }

  trackByIndex(index: number): number {
    return index;
  }

  private _mapPluginFieldType(type?: string): IssueFieldType {
    switch (type) {
      case 'text':
        return IssueFieldType.TEXT;
      case 'markdown':
        return IssueFieldType.MARKDOWN;
      case 'link':
        return IssueFieldType.LINK;
      case 'list':
        return IssueFieldType.CHIPS;
      case 'date':
        return IssueFieldType.TEXT;
      default:
        return IssueFieldType.TEXT;
    }
  }

  private _hasCommentsField(issue: IssueData | undefined): boolean {
    const config = this.config();
    if (!config?.comments || !issue) return false;
    return (
      config.comments.field in issue &&
      Array.isArray((issue as any)[config.comments.field])
    );
  }

  private _getCommentsArray(issue: IssueData | undefined): IssueComment[] {
    const config = this.config();
    if (!config?.comments || !issue) return [];
    const comments = issue[config.comments.field];
    return Array.isArray(comments) ? comments : [];
  }

  hideUpdates(): void {
    const task = this.currentTask();
    if (task?.id && task?.issueId) {
      this._taskService.markIssueUpdatesAsRead(task.id);
    }
  }

  showAllContent(): void {
    this.isForceShowAllComments.set(true);
  }
}
