import { inject, Injectable } from '@angular/core';
import {
  IssueData,
  IssueDataReduced,
  IssueProvider,
  IssueProviderKey,
  SearchResultItem,
  SearchResultItemWithProviderId,
} from './issue.model';
import { TaskAttachment } from '../tasks/task-attachment/task-attachment.model';
import { forkJoin, from, merge, Observable, of, Subject } from 'rxjs';
import {
  CALDAV_TYPE,
  GITEA_TYPE,
  GITHUB_TYPE,
  GITLAB_TYPE,
  ICAL_TYPE,
  ISSUE_PROVIDER_HUMANIZED,
  ISSUE_PROVIDER_ICON_MAP,
  ISSUE_STR_MAP,
  JIRA_TYPE,
  OPEN_PROJECT_TYPE,
  TRELLO_TYPE,
  REDMINE_TYPE,
  LINEAR_TYPE,
  CLICKUP_TYPE,
} from './issue.const';
import { TaskService } from '../tasks/task.service';
import { IssueTask, Task, TaskCopy } from '../tasks/task.model';
import { IssueServiceInterface } from './issue-service-interface';
import { JiraCommonInterfacesService } from './providers/jira/jira-common-interfaces.service';
import { GithubCommonInterfacesService } from './providers/github/github-common-interfaces.service';
import { TrelloCommonInterfacesService } from './providers/trello/trello-common-interfaces.service';
import { catchError, map, switchMap } from 'rxjs/operators';
import { IssueLog } from '../../core/log';
import { GitlabCommonInterfacesService } from './providers/gitlab/gitlab-common-interfaces.service';
import { CaldavCommonInterfacesService } from './providers/caldav/caldav-common-interfaces.service';
import { OpenProjectCommonInterfacesService } from './providers/open-project/open-project-common-interfaces.service';
import { GiteaCommonInterfacesService } from './providers/gitea/gitea-common-interfaces.service';
import { RedmineCommonInterfacesService } from './providers/redmine/redmine-common-interfaces.service';
import { LinearCommonInterfacesService } from './providers/linear/linear-common-interfaces.service';
import { ClickUpCommonInterfacesService } from './providers/clickup/clickup-common-interfaces.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { TranslateService } from '@ngx-translate/core';
import { CalendarCommonInterfacesService } from './providers/calendar/calendar-common-interfaces.service';
import { ICalIssueReduced } from './providers/calendar/calendar.model';
import { WorkContextType } from '../work-context/work-context.model';
import { WorkContextService } from '../work-context/work-context.service';
import { ProjectService } from '../project/project.service';
import { IssueProviderService } from './issue-provider.service';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { getCalendarEventIdCandidates } from '../calendar-integration/get-calendar-event-id-candidates';
import { Store } from '@ngrx/store';
import { selectEnabledIssueProviders } from './store/issue-provider.selectors';
import { getErrorTxt } from '../../util/get-error-text';
import { getDbDateStr } from '../../util/get-db-date-str';
import { TODAY_TAG } from '../tag/tag.const';
import typia from 'typia';
import { GlobalProgressBarService } from '../../core-ui/global-progress-bar/global-progress-bar.service';
import { NavigateToTaskService } from '../../core-ui/navigate-to-task/navigate-to-task.service';

@Injectable({
  providedIn: 'root',
})
export class IssueService {
  private _taskService = inject(TaskService);
  private _jiraCommonInterfacesService = inject(JiraCommonInterfacesService);
  private _trelloCommonInterfacesService = inject(TrelloCommonInterfacesService);
  private _githubCommonInterfacesService = inject(GithubCommonInterfacesService);
  private _gitlabCommonInterfacesService = inject(GitlabCommonInterfacesService);
  private _caldavCommonInterfaceService = inject(CaldavCommonInterfacesService);
  private _openProjectInterfaceService = inject(OpenProjectCommonInterfacesService);
  private _giteaInterfaceService = inject(GiteaCommonInterfacesService);
  private _redmineInterfaceService = inject(RedmineCommonInterfacesService);
  private _linearCommonInterfaceService = inject(LinearCommonInterfacesService);
  private _clickUpCommonInterfaceService = inject(ClickUpCommonInterfacesService);
  private _calendarCommonInterfaceService = inject(CalendarCommonInterfacesService);
  private _issueProviderService = inject(IssueProviderService);
  private _workContextService = inject(WorkContextService);
  private _snackService = inject(SnackService);
  private _translateService = inject(TranslateService);
  private _projectService = inject(ProjectService);
  private _calendarIntegrationService = inject(CalendarIntegrationService);
  private _store = inject(Store);
  private _globalProgressBarService = inject(GlobalProgressBarService);
  private _navigateToTaskService = inject(NavigateToTaskService);

  ISSUE_SERVICE_MAP: { [key: string]: IssueServiceInterface } = {
    [GITLAB_TYPE]: this._gitlabCommonInterfacesService,
    [GITHUB_TYPE]: this._githubCommonInterfacesService,
    [JIRA_TYPE]: this._jiraCommonInterfacesService,
    [CALDAV_TYPE]: this._caldavCommonInterfaceService,
    [OPEN_PROJECT_TYPE]: this._openProjectInterfaceService,
    [GITEA_TYPE]: this._giteaInterfaceService,
    [REDMINE_TYPE]: this._redmineInterfaceService,
    [ICAL_TYPE]: this._calendarCommonInterfaceService,
    [LINEAR_TYPE]: this._linearCommonInterfaceService,
    [CLICKUP_TYPE]: this._clickUpCommonInterfaceService,

    // trello
    [TRELLO_TYPE]: this._trelloCommonInterfacesService,
  };

  ISSUE_REFRESH_MAP: {
    [issueProviderId: string]: { [issueId: string]: Subject<IssueData> };
  } = {};

  testConnection(issueProviderCfg: IssueProvider): Promise<boolean> {
    return this.ISSUE_SERVICE_MAP[issueProviderCfg.issueProviderKey].testConnection(
      issueProviderCfg,
    );
  }

  getById(
    issueType: IssueProviderKey,
    id: string | number,
    issueProviderId: string,
  ): Promise<IssueData | null> {
    return this.ISSUE_SERVICE_MAP[issueType].getById(id, issueProviderId);
  }

  // Keep Observable version for components that need real-time updates via refresh
  getById$(
    issueType: IssueProviderKey,
    id: string | number,
    issueProviderId: string,
  ): Observable<IssueData | null> {
    // account for (manual) issue refreshing
    if (!this.ISSUE_REFRESH_MAP[issueProviderId]) {
      this.ISSUE_REFRESH_MAP[issueProviderId] = {};
    }
    if (!this.ISSUE_REFRESH_MAP[issueProviderId][id]) {
      this.ISSUE_REFRESH_MAP[issueProviderId][id] = new Subject<IssueData>();
    }
    return from(this.ISSUE_SERVICE_MAP[issueType].getById(id, issueProviderId)).pipe(
      switchMap((issue) => merge(of(issue), this.ISSUE_REFRESH_MAP[issueProviderId][id])),
    );
  }

  searchIssues(
    searchTerm: string,
    issueProviderId: string,
    issueProviderKey: IssueProviderKey,
    isEmptySearch = false,
  ): Promise<SearchResultItem[]> {
    // check if text is more than just special chars
    if (searchTerm.replace(/[^\p{L}\p{N}]+/gu, '').length === 0 && !isEmptySearch) {
      return Promise.resolve([]);
    }
    return this.ISSUE_SERVICE_MAP[issueProviderKey].searchIssues(
      searchTerm,
      issueProviderId,
    );
  }

  searchAllEnabledIssueProviders$(
    searchTerm: string,
  ): Observable<SearchResultItemWithProviderId[]> {
    return this._store.select(selectEnabledIssueProviders).pipe(
      switchMap((enabledProviders) => {
        if (enabledProviders.length === 0) {
          return of([]);
        }

        const searchObservables = enabledProviders.map((provider) =>
          from(
            this.searchIssues(searchTerm, provider.id, provider.issueProviderKey),
          ).pipe(
            map((results) =>
              results.map((result) => ({
                ...result,
                issueProviderId: provider.id,
              })),
            ),
            catchError((err) => {
              this._snackService.open({
                svgIco: ISSUE_PROVIDER_ICON_MAP[provider.issueProviderKey],
                msg: T.F.ISSUE.S.ERR_GENERIC,
                type: 'ERROR',
                translateParams: {
                  issueProviderName: ISSUE_PROVIDER_HUMANIZED[provider.issueProviderKey],
                  errTxt: getErrorTxt(err),
                },
              });
              throw new Error(err);
            }),
          ),
        );
        return forkJoin(searchObservables).pipe(map((results) => results.flat()));
      }),
    );
  }

  issueLink(
    issueType: IssueProviderKey,
    issueId: string | number,
    issueProviderId: string,
  ): Promise<string> {
    return this.ISSUE_SERVICE_MAP[issueType].issueLink(issueId, issueProviderId);
  }

  getPollInterval(providerKey: IssueProviderKey): number {
    return this.ISSUE_SERVICE_MAP[providerKey].pollInterval;
  }

  getMappedAttachments(
    issueType: IssueProviderKey,
    issueDataIN: IssueData,
  ): TaskAttachment[] {
    if (!this.ISSUE_SERVICE_MAP[issueType].getMappedAttachments) {
      return [];
    }
    return (this.ISSUE_SERVICE_MAP[issueType].getMappedAttachments as any)(issueDataIN);
  }

  async checkAndImportNewIssuesToBacklogForProject(
    providerKey: IssueProviderKey,
    issueProviderId: string,
  ): Promise<void> {
    if (!this.ISSUE_SERVICE_MAP[providerKey].getNewIssuesToAddToBacklog) {
      return;
    }
    this._snackService.open({
      svgIco: ISSUE_PROVIDER_ICON_MAP[providerKey],
      msg: T.F.ISSUE.S.POLLING_BACKLOG,
      isSpinner: true,
      translateParams: {
        issueProviderName: ISSUE_PROVIDER_HUMANIZED[providerKey],
        issuesStr: this._translateService.instant(ISSUE_STR_MAP[providerKey].ISSUES_STR),
      },
    });

    const allExistingIssueIds: string[] | number[] =
      await this._taskService.getAllIssueIdsForProviderEverywhere(issueProviderId);

    const potentialIssuesToAdd = await (
      this.ISSUE_SERVICE_MAP[providerKey] as any
    ).getNewIssuesToAddToBacklog(issueProviderId, allExistingIssueIds);

    const issuesToAdd: IssueDataReduced[] = potentialIssuesToAdd.filter(
      (issue: IssueData): boolean =>
        !(allExistingIssueIds as string[]).includes(issue.id as string),
    );

    issuesToAdd.forEach((issue: IssueDataReduced) => {
      // TODO add correct project id
      this.addTaskFromIssue({
        issueDataReduced: issue,
        issueProviderId,
        issueProviderKey: providerKey,
        isAddToBacklog: true,
      });
    });

    if (issuesToAdd.length === 1) {
      const issueTitle = this._getAddTaskData(providerKey, issuesToAdd[0]).title;
      this._snackService.open({
        svgIco: ISSUE_PROVIDER_ICON_MAP[providerKey],
        // ico: 'cloud_download',
        msg: T.F.ISSUE.S.IMPORTED_SINGLE_ISSUE,
        translateParams: {
          issueProviderName: ISSUE_PROVIDER_HUMANIZED[providerKey],
          issueStr: this._translateService.instant(ISSUE_STR_MAP[providerKey].ISSUE_STR),
          issueTitle,
        },
      });
    } else if (issuesToAdd.length > 1) {
      this._snackService.open({
        svgIco: ISSUE_PROVIDER_ICON_MAP[providerKey],
        // ico: 'cloud_download',
        msg: T.F.ISSUE.S.IMPORTED_MULTIPLE_ISSUES,
        translateParams: {
          issueProviderName: ISSUE_PROVIDER_HUMANIZED[providerKey],
          issuesStr: this._translateService.instant(
            ISSUE_STR_MAP[providerKey].ISSUES_STR,
          ),
          nr: issuesToAdd.length,
        },
      });
    }
  }

  async refreshIssueTask(
    task: Task,
    isNotifySuccess: boolean = true,
    isNotifyNoUpdateRequired: boolean = false,
  ): Promise<void> {
    const { issueId, issueType, issueProviderId } = task;

    if (!issueId || !issueType || !issueProviderId) {
      throw new Error('No issue task');
    }
    if (!this.ISSUE_SERVICE_MAP[issueType].getFreshDataForIssueTask) {
      throw new Error('Issue method not available');
    }

    const update = await (
      this.ISSUE_SERVICE_MAP[issueType].getFreshDataForIssueTask as any
    )(task, isNotifySuccess, isNotifyNoUpdateRequired);

    if (update) {
      if (this.ISSUE_REFRESH_MAP[issueProviderId]?.[issueId]) {
        this.ISSUE_REFRESH_MAP[issueProviderId][issueId].next(update.issue);
      }
      this._taskService.update(task.id, update.taskChanges);

      if (isNotifySuccess) {
        this._snackService.open({
          svgIco: ISSUE_PROVIDER_ICON_MAP[issueType],
          msg: T.F.ISSUE.S.ISSUE_UPDATE_SINGLE,
          translateParams: {
            issueProviderName: ISSUE_PROVIDER_HUMANIZED[issueType],
            issueStr: this._translateService.instant(ISSUE_STR_MAP[issueType].ISSUE_STR),
            issueTitle: update.issueTitle,
          },
        });
      }
    } else if (isNotifyNoUpdateRequired) {
      this._snackService.open({
        svgIco: ISSUE_PROVIDER_ICON_MAP[issueType],
        msg: T.F.ISSUE.S.ISSUE_NO_UPDATE_REQUIRED,
        translateParams: {
          issueProviderName: ISSUE_PROVIDER_HUMANIZED[issueType],
        },
      });
    }
  }

  // TODO given we have issueProvider available, we could also just pass that
  async refreshIssueTasks(tasks: Task[], issueProvider: IssueProvider): Promise<void> {
    // dynamic map that has a list of tasks for every entry where the entry is an issue type
    const tasksIssueIdsByIssueProviderKey: any = {};
    const tasksWithoutIssueId: Readonly<Task>[] = [];

    for (const task of tasks) {
      if (!task.issueId || !task.issueType) {
        tasksWithoutIssueId.push(task);
      } else if (!tasksIssueIdsByIssueProviderKey[task.issueType]) {
        tasksIssueIdsByIssueProviderKey[task.issueType] = [];
        tasksIssueIdsByIssueProviderKey[task.issueType].push(task);
      } else {
        tasksIssueIdsByIssueProviderKey[task.issueType].push(task);
      }
    }

    for (const pKey of Object.keys(tasksIssueIdsByIssueProviderKey)) {
      const providerKey = pKey as IssueProviderKey;
      IssueLog.log(
        'POLLING CHANGES FOR ' + providerKey,
        tasksIssueIdsByIssueProviderKey[providerKey],
      );
      const pollingLabelParams = {
        issueProviderName: ISSUE_PROVIDER_HUMANIZED[providerKey],
        issuesStr: this._translateService.instant(ISSUE_STR_MAP[providerKey].ISSUES_STR),
      };

      this._globalProgressBarService.countUp('POLL', {
        labelParams: pollingLabelParams,
      });

      let updates: {
        task: Task;
        taskChanges: Partial<Task>;
        issue: IssueData;
      }[] = [];
      try {
        updates = await this.ISSUE_SERVICE_MAP[providerKey].getFreshDataForIssueTasks(
          tasksIssueIdsByIssueProviderKey[providerKey],
        );
      } finally {
        this._globalProgressBarService.countDown();
      }

      if (updates.length > 0) {
        for (const update of updates) {
          if (this.ISSUE_REFRESH_MAP[issueProvider.id]?.[update.task.issueId as string]) {
            this.ISSUE_REFRESH_MAP[issueProvider.id][update.task.issueId as string].next(
              update.issue,
            );
          }
          this._taskService.update(update.task.id, update.taskChanges);
        }

        if (updates.length === 1) {
          this._snackService.open({
            svgIco: ISSUE_PROVIDER_ICON_MAP[providerKey],
            msg: T.F.ISSUE.S.ISSUE_UPDATE_SINGLE,
            translateParams: {
              issueProviderName: ISSUE_PROVIDER_HUMANIZED[providerKey],
              issueStr: this._translateService.instant(
                ISSUE_STR_MAP[providerKey].ISSUE_STR,
              ),
              issueTitle: updates[0].taskChanges.title || updates[0].task.title,
            },
          });
        } else if (updates.length > 1) {
          this._snackService.open({
            svgIco: ISSUE_PROVIDER_ICON_MAP[providerKey],
            msg: T.F.ISSUE.S.ISSUE_UPDATE_MULTIPLE,
            translateParams: {
              issueProviderName: ISSUE_PROVIDER_HUMANIZED[providerKey],
              issuesStr: this._translateService.instant(
                ISSUE_STR_MAP[providerKey].ISSUES_STR,
              ),
              nr: updates.length,
            },
          });
        }
      }
    }

    for (const taskWithoutIssueId of tasksWithoutIssueId) {
      throw new Error('No issue task ' + taskWithoutIssueId.id);
    }
  }

  async addTaskFromIssue({
    issueDataReduced,
    issueProviderId,
    issueProviderKey,
    additional = {},
    isAddToBacklog = false,
    isForceDefaultProject = false,
  }: {
    issueDataReduced: IssueDataReduced;
    issueProviderId: string;
    issueProviderKey: IssueProviderKey;
    additional?: Partial<Task>;
    isAddToBacklog?: boolean;
    isForceDefaultProject?: boolean;
  }): Promise<string | undefined> {
    if (!issueDataReduced || !issueDataReduced.id || !issueProviderId) {
      throw new Error('No issueData');
    }

    const issueIdCandidates = this._getIssueIdCandidates(
      issueProviderKey,
      issueDataReduced,
    );

    if (
      await this._checkAndHandleIssueAlreadyAdded(
        issueProviderKey,
        issueProviderId,
        issueDataReduced.id.toString(),
        { issueIdCandidates },
      )
    ) {
      return undefined;
    }

    const {
      title = null,
      related_to,
      ...additionalFromProviderIssueService
    } = this._getAddTaskData(issueProviderKey, issueDataReduced);
    IssueLog.log({ title, related_to, additionalFromProviderIssueService });

    const getProjectOrTagId = async (): Promise<Partial<TaskCopy>> => {
      const defaultProjectId = (
        await this._issueProviderService
          .getCfgOnce$(issueProviderId, issueProviderKey)
          .toPromise()
      ).defaultProjectId;

      if (typeof this._workContextService.activeWorkContextId !== 'string') {
        throw new Error('No active work context id');
      }

      if (
        this._workContextService.activeWorkContextType === WorkContextType.PROJECT &&
        !isForceDefaultProject
      ) {
        return {
          projectId: defaultProjectId || this._workContextService.activeWorkContextId,
        };
      } else {
        return {
          tagIds:
            this._workContextService.activeWorkContextType === WorkContextType.TAG &&
            this._workContextService.activeWorkContextId !== TODAY_TAG.id
              ? [this._workContextService.activeWorkContextId]
              : [],
          projectId: defaultProjectId || undefined,
        };
      }
    };

    const taskData = {
      issueType: issueProviderKey,
      issueProviderId: issueProviderId,
      issueId: issueDataReduced.id.toString(),
      issueWasUpdated: false,
      issueLastUpdated: Date.now(),
      // Default plan for today unless a precise time is provided by provider
      dueDay: getDbDateStr(),
      ...additionalFromProviderIssueService,
      // NOTE: if we were to add tags, this could be overwritten here
      ...(await getProjectOrTagId()),
      ...additional,
    };

    // If a precise start time is provided by the provider, avoid setting dueDay as well
    if ((taskData as Partial<TaskCopy>).dueWithTime) {
      (taskData as Partial<TaskCopy>).dueDay = undefined;
    }

    let taskId: string | undefined;

    if (related_to) {
      taskId = await this._tryAddSubTask({
        title: title as string,
        taskData,
        issueParentId: related_to,
        issueProviderId,
        issueProviderKey,
      });
    }

    // add new task (also fallback when parent id of subtask is not found)
    if (!taskId) {
      taskId = taskData.dueWithTime
        ? await this._taskService.addAndSchedule(title, taskData, taskData.dueWithTime)
        : this._taskService.add(title, isAddToBacklog, taskData);

      // TODO more elegant solution for skipped calendar events
      if (issueProviderKey === ICAL_TYPE) {
        this._calendarIntegrationService.skipCalendarEvent(
          issueDataReduced as ICalIssueReduced,
        );
      }

      // Handle subtasks if provider supports it
      if (this.ISSUE_SERVICE_MAP[issueProviderKey].getSubTasks && taskId) {
        await this._addSubTasks(
          issueDataReduced,
          taskId,
          issueProviderId,
          issueProviderKey,
        );
      }
    }

    return taskId;
  }

  private async _addSubTasks(
    issueDataReduced: IssueDataReduced,
    parentTaskId: string,
    issueProviderId: string,
    issueProviderKey: IssueProviderKey,
  ): Promise<void> {
    const provider = this.ISSUE_SERVICE_MAP[issueProviderKey];
    if (!provider.getSubTasks) {
      return;
    }
    try {
      const subtasks = await provider.getSubTasks(
        issueDataReduced.id,
        issueProviderId,
        issueDataReduced,
      );

      if (!subtasks || subtasks.length === 0) {
        return;
      }

      for (const subtask of subtasks) {
        const subTaskData = this._getAddTaskData(issueProviderKey, subtask);
        const { title: subTaskTitle, ...subTaskAdditional } = subTaskData;

        await this._taskService.addSubTaskTo(parentTaskId, {
          title: subTaskTitle,
          issueType: issueProviderKey,
          issueProviderId: issueProviderId,
          issueId: subtask.id.toString(),
          issueWasUpdated: false,
          issueLastUpdated: Date.now(),
          ...subTaskAdditional,
        });
      }
    } catch (e) {
      IssueLog.warn('Failed to add subtasks for ' + issueProviderKey, e);
    }
  }

  private async _tryAddSubTask({
    title,
    taskData,
    issueParentId,
    issueProviderId,
    issueProviderKey,
  }: {
    title: string;
    taskData: Partial<Task>;
    issueParentId: string;
    issueProviderId: string;
    issueProviderKey: IssueProviderKey;
  }): Promise<string | undefined> {
    const parentTask = await this._taskService.checkForTaskWithIssueEverywhere(
      issueParentId,
      issueProviderKey,
      issueProviderId,
    );

    if (parentTask) {
      const subTaskData = { title, ...taskData } as Partial<TaskCopy>;
      // Ensure invariants for sub-tasks as well
      if (subTaskData.dueWithTime) {
        subTaskData.dueDay = undefined;
      }
      return this._taskService.addSubTaskTo(parentTask.task.id, subTaskData);
    }

    return undefined;
  }

  private async _checkAndHandleIssueAlreadyAdded(
    issueType: IssueProviderKey,
    issueProviderId: string,
    issueId: string,
    opts?: { issueIdCandidates?: string[] },
  ): Promise<boolean> {
    const idsToCheck = Array.from(
      new Set(
        opts?.issueIdCandidates && opts.issueIdCandidates.length
          ? [issueId, ...opts.issueIdCandidates]
          : [issueId],
      ),
    );

    let res: Awaited<
      ReturnType<typeof this._taskService.checkForTaskWithIssueEverywhere>
    > | null = null;
    for (const candidateId of idsToCheck) {
      res = await this._taskService.checkForTaskWithIssueEverywhere(
        candidateId,
        issueType,
        issueProviderId,
      );
      if (res) {
        break;
      }
    }

    if (res?.isFromArchive) {
      this._taskService.restoreTask(res.task, res.subTasks || []);
      this._snackService.open({
        ico: 'info',
        msg: T.F.TASK.S.FOUND_RESTORE_FROM_ARCHIVE,
        translateParams: { title: res.task.title },
      });
      return true;
    } else if (res?.task) {
      if (
        res.task.projectId &&
        res.task.projectId === this._workContextService.activeWorkContextId
      ) {
        this._projectService.moveTaskToTodayList(res.task.id, res.task.projectId);
        this._snackService.open({
          ico: 'arrow_upward',
          msg: T.F.TASK.S.FOUND_MOVE_FROM_BACKLOG,
          translateParams: { title: res.task.title },
        });
        return true;
      } else if (issueType === ICAL_TYPE) {
        // For calendar events, don't move to today - just show snackbar with navigation
        const taskId = res.task.id;
        this._snackService.open({
          ico: 'info',
          msg: T.F.TASK.S.TASK_ALREADY_EXISTS,
          translateParams: { title: res.task.title },
          actionStr: T.F.TASK.S.GO_TO_TASK,
          actionFn: () => {
            this._navigateToTaskService.navigate(taskId, false);
          },
        });
        return true;
      } else {
        const taskWithTaskSubTasks = await this._taskService
          .getByIdWithSubTaskData$(res.task.id)
          .toPromise();
        this._taskService.moveToCurrentWorkContext(taskWithTaskSubTasks);
        this._snackService.open({
          ico: 'arrow_upward',
          msg: T.F.TASK.S.FOUND_MOVE_FROM_OTHER_LIST,
          translateParams: {
            title: res.task.title,
            contextTitle: res.task.projectId
              ? (await this._projectService.getByIdOnce$(res.task.projectId).toPromise())
                  ?.title
              : 'another tag',
          },
        });
        return true;
      }
    }

    return false;
  }

  private _getAddTaskData(
    issueProviderKey: IssueProviderKey,
    issueReduced: IssueDataReduced,
  ): IssueTask {
    if (!this.ISSUE_SERVICE_MAP[issueProviderKey].getAddTaskData) {
      throw new Error('Issue method not available');
    }
    const r = this.ISSUE_SERVICE_MAP[issueProviderKey].getAddTaskData(issueReduced);
    typia.assert<IssueTask>(r);
    return r;
  }

  private _getIssueIdCandidates(
    issueProviderKey: IssueProviderKey,
    issueDataReduced: IssueDataReduced,
  ): string[] | undefined {
    if (issueProviderKey !== ICAL_TYPE) {
      return undefined;
    }
    return getCalendarEventIdCandidates(issueDataReduced as ICalIssueReduced);
  }

  // TODO if we need to refresh data on after add, this is how we would do it
  // try {
  //   const freshIssueData = await this.ISSUE_SERVICE_MAP[issueProviderKey]
  //     .getById$(issueDataReduced.issueData.id, issueProvider.id)
  //     .toPromise();
  //   // eslint-disable-next-line @typescript-eslint/no-shadow
  //   const { title = null, ...additionalFields } =
  //     this.ISSUE_SERVICE_MAP[issueProviderKey].getAddTaskData(freshIssueData);
  //   this._taskService.update(taskId, {});
  // } catch (e) {
  //   IssueLog.err(e);
  //   this._taskService.remove(taskId);
  //   // TODO show error msg
  // }
}
