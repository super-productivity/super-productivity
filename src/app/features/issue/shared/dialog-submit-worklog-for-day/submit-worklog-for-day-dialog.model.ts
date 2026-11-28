import { Task } from '../../../tasks/task.model';

export interface SubmitWorklogForDayDialogData {
  /** The day being finished (YYYY-MM-DD) */
  day: string;
  providerName: string;
  icon?: string;
  /** Tasks of one issue provider with time tracked on `day` */
  tasks: Task[];
  getTimeLogged?: (issueId: string) => Promise<number>;
  /** Rejects when the entry was not created; the row then stays in the dialog. */
  logTime: (issueId: string, timeSpentMs: number) => Promise<void>;
}
