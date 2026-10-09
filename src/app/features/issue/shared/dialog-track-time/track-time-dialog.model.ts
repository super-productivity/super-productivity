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

  // Activities (e.g. Redmine/OpenProject)
  activities$?: Observable<Array<{ id: number; name: string }>>;

  // Provider config — passed directly so the dialog doesn't need to fetch it
  defaultTime?: JiraWorklogExportDefaultTime;
  configTimeKey: 'worklogDialogDefaultTime' | 'timeTrackingDialogDefaultTime';
  // Persists a new default time; when unset, the dialog writes `configTimeKey`
  // as a top-level provider field (plugin providers keep it in `pluginConfig`)
  saveDefaultTime?: (value: JiraWorklogExportDefaultTime) => void;

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
