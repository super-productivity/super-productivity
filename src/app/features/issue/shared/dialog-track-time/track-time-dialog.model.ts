import { Task } from '../../../tasks/task.model';
import { Observable } from 'rxjs';
import { JiraWorklogExportDefaultTime } from '../../providers/jira/jira.model';

export interface TrackTimeSubmitParams {
  timeSpent: number;
  started: string;
  comment: string;
  activityId?: number;
}

export interface TrackTimeDialogData {
  task: Task;

  // Issue display
  issueIcon: string;
  issueLabel: string;
  issueUrl?: string;

  // Logged time
  timeLogged: number;
  timeLoggedUpdate$?: Observable<number>;

  // Activities (Redmine/OpenProject)
  activities$?: Observable<Array<{ id: number; name: string }>>;

  // Provider config — passed directly so the dialog doesn't need to fetch it
  defaultTime?: JiraWorklogExportDefaultTime;
  configTimeKey: 'worklogDialogDefaultTime' | 'timeTrackingDialogDefaultTime';

  // Submit handling
  onSubmit: (params: TrackTimeSubmitParams) => Observable<unknown>;
  successMsg: string;
  successTranslateParams: Record<string, string>;

  // Provider-specific translation keys (labels that differ per provider)
  t: {
    title: string;
    submitFor: string;
    currentlyLogged?: string;
    submit: string;
    timeSpent: string;
    timeSpentTooltip: string;
    started: string;
    invalidDate: string;
    comment: string;
    activity?: string;
  };
}
