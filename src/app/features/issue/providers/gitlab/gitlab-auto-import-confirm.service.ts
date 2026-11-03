import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { T } from '../../../../t.const';
import { DialogConfirmComponent } from '../../../../ui/dialog-confirm/dialog-confirm.component';
import { IssueLog } from '../../../../core/log';
import { IssueProviderGitlab } from '../../issue.model';
import { GitlabApiService } from './gitlab-api/gitlab-api.service';
import { GITLAB_MAX_AUTO_IMPORT_ISSUES } from './gitlab.const';

// Log only the error's name and code: its message can carry the request URL
const getSafeErrorLogMeta = (
  e: unknown,
): {
  errorName: string;
  errorCode?: string | number;
} => {
  const errorName =
    e instanceof Error
      ? e.name
      : typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string'
        ? e.name
        : 'UnknownError';
  const errorCode =
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (typeof e.code === 'string' || typeof e.code === 'number')
      ? e.code
      : undefined;

  return errorCode === undefined ? { errorName } : { errorName, errorCode };
};

// Config keys that change which issues auto-import fetches
const AUTO_IMPORT_CFG_KEYS = [
  'issueSource',
  'project',
  'group',
  'scope',
  'filter',
  'gitlabBaseUrl',
] as const;

/**
 * Before a GitLab provider with auto-import is saved, shows how many open issues
 * would be imported, and blocks saving above GITLAB_MAX_AUTO_IMPORT_ISSUES. A group
 * or instance-wide source can match thousands of issues, so the user can narrow it
 * before the first poll floods the backlog.
 */
@Injectable({
  providedIn: 'root',
})
export class GitlabAutoImportConfirmService {
  private _gitlabApiService = inject(GitlabApiService);
  private _matDialog = inject(MatDialog);

  /**
   * Resolves true when saving may go ahead.
   * @param saved the stored provider when editing, undefined for a new one
   * @param isAborted checked after the count; true when the caller went away meanwhile
   */
  async confirmSave(
    model: IssueProviderGitlab,
    saved: IssueProviderGitlab | undefined,
    isAborted: () => boolean,
  ): Promise<boolean> {
    if (!model.isEnabled || !model.isAutoAddToBacklog) {
      return true;
    }
    if (!this._isAutoImportSetupChanged(model, saved)) {
      return true;
    }

    let total: number | null;
    try {
      total = await firstValueFrom(
        this._gitlabApiService.getAutoImportIssueCount$(model),
      );
    } catch (e) {
      // Don't block saving: a broken connection is reported by the import poll itself
      IssueLog.err(
        '[GitlabAutoImportConfirm] Auto-import count failed',
        getSafeErrorLogMeta(e),
      );
      return true;
    }
    if (isAborted()) {
      return false;
    }

    const limit = GITLAB_MAX_AUTO_IMPORT_ISSUES;
    // GitLab omits the total above 10,000 results, which is over the limit
    const isOverLimit = total === null || total > limit;
    const isConfirmed = await firstValueFrom(
      this._matDialog
        .open(DialogConfirmComponent, {
          restoreFocus: true,
          data: {
            okTxt: T.G.SAVE,
            cancelTxt: T.F.GITLAB.AUTO_IMPORT.BACK_TO_SETTINGS,
            message: isOverLimit
              ? T.F.GITLAB.AUTO_IMPORT.OVER_LIMIT
              : T.F.GITLAB.AUTO_IMPORT.CONFIRM,
            // Over the limit the user can only go back and narrow the settings
            isConfirmDisabled: isOverLimit,
            translateParams: { nr: total ?? '10,000+', max: limit },
          },
        })
        .afterClosed(),
    );
    return !isOverLimit && !!isConfirmed;
  }

  private _isAutoImportSetupChanged(
    model: IssueProviderGitlab,
    saved: IssueProviderGitlab | undefined,
  ): boolean {
    if (!saved?.isEnabled || !saved.isAutoAddToBacklog) {
      return true;
    }
    return AUTO_IMPORT_CFG_KEYS.some(
      (key) => (saved[key] ?? null) !== (model[key] ?? null),
    );
  }
}
