import { inject, Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Task } from 'src/app/features/tasks/task.model';
import { concatMap, first, map, switchMap } from 'rxjs/operators';
import { IssueServiceInterface } from '../../issue-service-interface';
import { GitlabApiService } from './gitlab-api/gitlab-api.service';
import { IssueData, IssueProviderGitlab, SearchResultItem } from '../../issue.model';
import { GitlabCfg } from './gitlab.model';
import { GitlabIssue } from './gitlab-issue.model';
import { truncate } from '../../../../util/truncate';
import { GITLAB_BASE_URL, GITLAB_POLL_INTERVAL } from './gitlab.const';
import { isGitlabEnabled } from './is-gitlab-enabled.util';
import { IssueProviderService } from '../../issue-provider.service';
import { TagService } from '../../../tag/tag.service';
import { MenuTreeService } from '../../../menu-tree/menu-tree.service';
import { Log } from '../../../../core/log';

@Injectable({
  providedIn: 'root',
})
export class GitlabCommonInterfacesService implements IssueServiceInterface {
  private readonly _gitlabApiService = inject(GitlabApiService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _tagService = inject(TagService);
  private readonly _menuTreeService = inject(MenuTreeService);

  logger = Log.withContext('gitlab');
  pollInterval: number = GITLAB_POLL_INTERVAL;

  isEnabled(cfg: GitlabCfg): boolean {
    return isGitlabEnabled(cfg);
  }

  testConnection(cfg: GitlabCfg): Promise<boolean> {
    return this._gitlabApiService
      .searchIssueInProject$('', cfg)
      .pipe(
        map((res) => Array.isArray(res)),
        first(),
      )
      .toPromise()
      .then((result) => result ?? false);
  }

  issueLink(issueId: string, issueProviderId: string): Promise<string> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        map((cfg) => {
          const project: string = cfg.project;

          // Extract just the numeric issue ID from formats like 'project/repo#123' or '#123'
          // Note: issueId is intentionally stored as 'project/repo#123' to ensure uniqueness across different projects
          // but for URL construction we only need the numeric part after the '#'
          const cleanIssueId = issueId.toString().replace(/^.*#/, '');

          if (cfg.gitlabBaseUrl) {
            const fixedUrl = cfg.gitlabBaseUrl.match(/.*\/$/)
              ? cfg.gitlabBaseUrl
              : `${cfg.gitlabBaseUrl}/`;
            return `${fixedUrl}${project}/-/issues/${cleanIssueId}`;
          } else {
            return `${GITLAB_BASE_URL}${project}/-/issues/${cleanIssueId}`;
          }
        }),
      )
      .toPromise()
      .then((result) => result ?? '');
  }

  getById(issueId: string, issueProviderId: string): Promise<GitlabIssue> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(concatMap((gitlabCfg) => this._gitlabApiService.getById$(issueId, gitlabCfg)))
      .toPromise()
      .then((result) => {
        if (!result) {
          throw new Error('Failed to get GitLab issue');
        }
        return result;
      });
  }

  searchIssues(searchTerm: string, issueProviderId: string): Promise<SearchResultItem[]> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        switchMap((gitlabCfg) =>
          this.isEnabled(gitlabCfg)
            ? this._gitlabApiService.searchIssueInProject$(searchTerm, gitlabCfg)
            : of([]),
        ),
      )
      .toPromise()
      .then((result) => result ?? []);
  }

  async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: GitlabIssue;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId) {
      throw new Error('No issueProviderId');
    }
    if (!task.issueId) {
      throw new Error('No issueId');
    }

    const cfg = await this._getCfgOnce$(task.issueProviderId).toPromise();
    const issue = await this._gitlabApiService.getById$(task.issueId, cfg).toPromise();

    const issueUpdate: number = new Date(issue.updated_at).getTime();
    const commentsByOthers =
      cfg.filterUsername && cfg.filterUsername.length > 1
        ? issue.comments.filter(
            (comment) => comment.author.username !== cfg.filterUsername,
          )
        : issue.comments;

    // TODO: we also need to handle the case when the user himself updated the issue, to also update the issue...
    const updates: number[] = [
      ...commentsByOthers.map((comment) => new Date(comment.created_at).getTime()),
      issueUpdate,
    ].sort();
    const lastRemoteUpdate = updates[updates.length - 1];

    const wasUpdated = lastRemoteUpdate > (task.issueLastUpdated || 0);
    const forceUpdate = cfg?.isForceUpdate || false;

    if (wasUpdated || forceUpdate) {
      const taskData = this.getAddTaskData(issue, cfg);

      const newTagIds = cfg?.isImportGitLabLabels ? taskData.tagIds || [] : [];
      const existingTagIds = task.tagIds || [];
      const mergedTagIds = [...new Set([...existingTagIds, ...newTagIds])];
      // this.logger.normal('GitLab update - merged tagIds:', mergedTagIds);
      return {
        taskChanges: {
          ...taskData,
          // Merge existing tags with new GitLab tags
          tagIds: mergedTagIds,
          issueWasUpdated: true,
        },
        issue,
        issueTitle: this._formatIssueTitleForSnack(issue),
      };
    }
    return null;
  }

  async getFreshDataForIssueTasks(
    tasks: Task[],
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: GitlabIssue }[]> {
    const issueProviderId =
      tasks && tasks[0].issueProviderId ? tasks[0].issueProviderId : 0;
    if (!issueProviderId) {
      throw new Error('No issueProviderId');
    }

    const cfg = await this._getCfgOnce$(issueProviderId).toPromise();

    const updatedIssues: {
      task: Task;
      taskChanges: Partial<Task>;
      issue: GitlabIssue;
    }[] = [];

    for (const task of tasks) {
      if (!task.issueId) {
        continue;
      }
      const issue = await this._gitlabApiService.getById$(task.issueId, cfg).toPromise();
      if (issue) {
        const issueUpdate: number = new Date(issue.updated_at).getTime();
        const commentsByOthers =
          cfg.filterUsername && cfg.filterUsername.length > 1
            ? issue.comments.filter(
                (comment) => comment.author.username !== cfg.filterUsername,
              )
            : issue.comments;

        const updates: number[] = [
          ...commentsByOthers.map((comment) => new Date(comment.created_at).getTime()),
          issueUpdate,
        ].sort();
        const lastRemoteUpdate = updates[updates.length - 1];
        const wasUpdated = lastRemoteUpdate > (task.issueLastUpdated || 0);
        const forceUpdate = cfg?.isForceUpdate || false;
        if (wasUpdated || forceUpdate) {
          const taskData = this.getAddTaskData(issue, cfg);
          const newTagIds = cfg?.isImportGitLabLabels ? taskData.tagIds || [] : [];
          const existingTagIds = task.tagIds || [];
          const gitlabFolderTagIds = this._getGitLabFolderTagIds();

          // Remove existing GitLab tags that are not in new tags
          const nonGitlabExistingTags = existingTagIds.filter(
            (tagId) => !gitlabFolderTagIds.includes(tagId),
          );
          const mergedTagIds = [...new Set([...nonGitlabExistingTags, ...newTagIds])];

          updatedIssues.push({
            task,
            taskChanges: {
              ...taskData,
              // Merge existing tags with new GitLab tags
              tagIds: mergedTagIds,
              issueWasUpdated: true,
            },
            issue,
          });
        }
      }
    }
    return updatedIssues;
  }

  getAddTaskData(issue: GitlabIssue, cfg?: GitlabCfg): Partial<Task> & { title: string } {
    const tagIds = cfg?.isImportGitLabLabels
      ? this._createTagsFromLabels(issue.labels)
      : [];
    // this.logger.normal('getAddTaskData returning tagIds:', tagIds);

    return {
      title: this._formatIssueTitle(issue),
      issuePoints: issue.weight,
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updated_at).getTime(),
      issueId: issue.id,
      isDone: this._isIssueDone(issue),
      // GitLab returns due_date as YYYY-MM-DD string, use it directly
      // to avoid timezone conversion issues
      dueDay: issue.due_date || undefined,
      tagIds,
    };
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: number[] | string[],
  ): Promise<IssueData[]> {
    const cfg = await this._getCfgOnce$(issueProviderId).toPromise();
    const issues = await this._gitlabApiService.getProjectIssues$(cfg).toPromise();

    // Add cfg to each issue for proper tag handling
    return issues.map((issue) => ({
      ...issue,
      ...this.getAddTaskData(issue, cfg),
    }));
  }

  private _formatIssueTitle(issue: GitlabIssue): string {
    return `#${issue.number} ${issue.title}`;
  }

  private _formatIssueTitleForSnack(issue: GitlabIssue): string {
    return `${truncate(this._formatIssueTitle(issue))}`;
  }

  private _getCfgOnce$(issueProviderId: string): Observable<IssueProviderGitlab> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, 'GITLAB');
  }

  private _isIssueDone(issue: GitlabIssue): boolean {
    return issue.state === 'closed';
  }

  // Add this helper method to get tags in GitLab folder
  private _getGitLabFolderTagIds(): string[] {
    const tagTree = this._menuTreeService.tagTree();
    const gitlabFolder = this._findGitLabFolder(tagTree);
    return gitlabFolder ? this._collectTagIdsFromFolder(gitlabFolder) : [];
  }

  private _findGitLabFolder(tree: any[]): any | null {
    for (const node of tree) {
      if (node.k === 'f' && node.name === 'GitLab') {
        return node;
      }
      if (node.k === 'f' && node.children) {
        const found = this._findGitLabFolder(node.children);
        if (found) return found;
      }
    }
    return null;
  }

  private _collectTagIdsFromFolder(folder: any): string[] {
    const tagIds: string[] = [];
    for (const child of folder.children) {
      if (child.k === 't') {
        tagIds.push(child.id);
      } else if (child.k === 'f') {
        tagIds.push(...this._collectTagIdsFromFolder(child));
      }
    }
    return tagIds;
  }

  private _createTagsFromLabels(labels: string[]): string[] {
    const existingTags = this._tagService.tags();
    const tagIds: string[] = [];
    const newTagIds: string[] = [];

    // Ensure GitLab folder exists
    this._menuTreeService.createTagFolderIfNotExists('GitLab');

    for (const label of labels) {
      const labelStr = label.toString();

      // Check if tag with this title already exists
      const existingTag = existingTags.find((tag) => tag.title === labelStr);

      if (existingTag) {
        tagIds.push(existingTag.id);
      } else {
        // Create new tag from GitLab label
        const newTagId = this._tagService.addTag({
          title: labelStr,
          color: this._generateColorFromLabel(labelStr),
        });
        tagIds.push(newTagId);
        newTagIds.push(newTagId);
      }
    }

    // Move newly created tags to GitLab folder (async, doesn't affect task creation)
    if (newTagIds.length > 0) {
      setTimeout(() => {
        newTagIds.forEach((tagId) => {
          this._menuTreeService.moveTagToFolder(tagId, 'GitLab');
        });
      }, 100);
    }

    return tagIds;
  }

  private _findFolderByName(tree: any[], name: string): boolean {
    for (const node of tree) {
      if (node.k === 'FOLDER' && node.name === name) {
        return true;
      }
      if (node.k === 'FOLDER' && node.children) {
        if (this._findFolderByName(node.children, name)) {
          return true;
        }
      }
    }
    return false;
  }

  private _generateColorFromLabel(label: string): string {
    // Generate a consistent color based on the label name
    // This ensures the same label always gets the same color
    let hash = 0;
    for (let i = 0; i < label.length; i++) {
      hash = label.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Convert hash to a pleasant color
    const hue = Math.abs(hash) % 360;
    const saturation = 65; // Medium saturation for readability
    const lightness = 50; // Medium lightness for good contrast

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }
}
