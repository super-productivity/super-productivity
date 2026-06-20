import { DestroyRef, inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IS_ELECTRON } from '../../app.constants';
import { Log } from '../../core/log';
import { TaskBuilderService } from './task-builder.service';
import type {
  AddTaskPayload,
  AddTaskSubmitResult,
} from './add-task-bar/add-task-payload-builder';
import { isQuickAddWindowMode } from '../../util/is-quick-add-window-mode';
import { validateQuickAddTaskPayload } from './quick-add-task-payload-validator';
import { ProjectService } from '../project/project.service';
import { TagService } from '../tag/tag.service';
import { GlobalConfigService } from '../config/global-config.service';
import { WorkContextService } from '../work-context/work-context.service';
import { DateService } from '../../core/date/date.service';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { MenuTreeService } from '../menu-tree/menu-tree.service';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import type {
  QuickAddHudSnapshot,
  QuickAddSnapshotResult,
} from './add-task-bar/quick-add-hud.model';

@Injectable({
  providedIn: 'root',
})
export class QuickAddTaskSubmitService {
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _taskBuilderService = inject(TaskBuilderService);
  private readonly _projectService = inject(ProjectService);
  private readonly _tagService = inject(TagService);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _dateService = inject(DateService);
  private readonly _dateTimeFormatService = inject(DateTimeFormatService);
  private readonly _menuTreeService = inject(MenuTreeService);
  private _isInitialized = false;

  init(): void {
    if (this._isInitialized || !IS_ELECTRON || isQuickAddWindowMode()) {
      return;
    }
    this._isInitialized = true;

    const unsubscribeSubmit = window.ea.onQuickAddTaskSubmitRequest(
      (requestId, payload) => {
        void this._submitTask(requestId, payload);
      },
    );
    const unsubscribeSnapshot = window.ea.onQuickAddSnapshotRequest((requestId) => {
      void this._sendSnapshot(requestId);
    });
    this._destroyRef.onDestroy(unsubscribeSubmit);
    this._destroyRef.onDestroy(unsubscribeSnapshot);
    window.ea.informQuickAddBridgeReady();
  }

  private async _submitTask(requestId: string, payload: AddTaskPayload): Promise<void> {
    const result = await this._buildSubmitResult(payload);
    window.ea.sendQuickAddTaskSubmitResponse(requestId, result);
  }

  private async _buildSubmitResult(
    payload: AddTaskPayload,
  ): Promise<AddTaskSubmitResult> {
    try {
      const validationError = validateQuickAddTaskPayload(payload, {
        projectIds: new Set(this._projectService.list().map((project) => project.id)),
        tagIds: new Set(this._tagService.tags().map((tag) => tag.id)),
      });
      if (validationError) {
        return { ok: false, error: validationError };
      }

      const taskId = await this._taskBuilderService.addTask(payload);
      return { ok: true, taskId };
    } catch (err) {
      Log.err('Quick Add task submit failed', err);
      return { ok: false, error: 'Unable to add task' };
    }
  }

  private async _sendSnapshot(requestId: string): Promise<void> {
    const result = await this._buildSnapshotResult();
    window.ea.sendQuickAddSnapshotResponse(requestId, result);
  }

  private async _buildSnapshotResult(): Promise<QuickAddSnapshotResult> {
    try {
      const activeWorkContext = await firstValueFrom(
        this._workContextService.activeWorkContext$,
      );
      const tasksCfg = this._globalConfigService.tasks();
      const reminderCfg =
        this._globalConfigService.cfg()?.reminder ?? DEFAULT_GLOBAL_CONFIG.reminder;
      const shortSyntax =
        this._globalConfigService.shortSyntax() ?? DEFAULT_GLOBAL_CONFIG.shortSyntax;
      const defaultProjectId =
        typeof tasksCfg?.defaultProjectId === 'string' && tasksCfg.defaultProjectId
          ? tasksCfg.defaultProjectId
          : null;
      const snapshot: QuickAddHudSnapshot = {
        projects: this._projectService.listInTreeOrderForUI().map((project) => ({
          id: project.id,
          title: project.title,
          icon: project.icon ?? null,
          theme: {
            primary: project.theme?.primary,
          },
          isEnableBacklog: project.isEnableBacklog,
        })),
        tags: this._tagService.tagsNoMyDayAndNoListInTreeOrder().map((tag) => ({
          id: tag.id,
          title: tag.title,
          icon: tag.icon ?? null,
          color: tag.color ?? null,
          theme: {
            primary: tag.theme?.primary,
          },
        })),
        defaultProjectId,
        defaultTaskRemindOption:
          reminderCfg.defaultTaskRemindOption ??
          DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
        shortSyntax,
        activeWorkContext: activeWorkContext
          ? {
              id: activeWorkContext.id,
              title: activeWorkContext.title,
              type: activeWorkContext.type,
              theme: {
                primary: activeWorkContext.theme?.primary,
              },
            }
          : null,
        todayStr: this._dateService.todayStr(),
        dateTimeLocale: this._dateTimeFormatService.currentLocale(),
        folderPaths: {
          projects: _mapToRecord(this._menuTreeService.projectFolderMap()),
          tags: _mapToRecord(this._menuTreeService.tagFolderMap()),
        },
        theme: _readThemeSnapshot(),
      };
      return { ok: true, snapshot };
    } catch (err) {
      Log.err('Quick Add snapshot build failed', err);
      return { ok: false, error: 'Unable to load Quick Add data' };
    }
  }
}

const _mapToRecord = (map: Map<string, string>): Record<string, string> =>
  Object.fromEntries(map.entries());

const _readThemeSnapshot = (): QuickAddHudSnapshot['theme'] => {
  const htmlClasses = _safeClassList(document.documentElement);
  const bodyClasses = _safeClassList(document.body);
  const htmlCssVars = _readCssVars(document.documentElement);
  const bodyCssVars = _readCssVars(document.body);

  return {
    htmlClasses,
    bodyClasses,
    htmlCssVars,
    bodyCssVars,
  };
};

const _readCssVars = (element: HTMLElement): Record<string, string> => {
  const style = getComputedStyle(element);
  const cssVars: Record<string, string> = {};

  for (let i = 0; i < style.length; i++) {
    const propertyName = style.item(i);
    if (propertyName.startsWith('--')) {
      cssVars[propertyName] = style.getPropertyValue(propertyName);
    }
  }

  return cssVars;
};

const _safeClassList = (el: HTMLElement): string[] =>
  Array.from(el.classList).filter((className) => className !== 'isQuickAddHud');
