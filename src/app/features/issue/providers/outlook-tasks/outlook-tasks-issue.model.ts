export enum OutlookTaskStatus {
  NOT_STARTED = 'notStarted',
  IN_PROGRESS = 'inProgress',
  COMPLETED = 'completed',
  WAITING_ON_OTHERS = 'waitingOnOthers',
  DEFERRED = 'deferred',
}

export enum OutlookTaskImportance {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
}

export type OutlookTasksIssueReduced = Readonly<{
  id: string;
  title: string;
  status: OutlookTaskStatus;
  importance: OutlookTaskImportance;
  isReminderOn: boolean;
  lastModifiedDateTime: string;
}>;

export type OutlookTasksIssue = OutlookTasksIssueReduced &
  Readonly<{
    body?: {
      content: string;
      contentType: 'text' | 'html';
    };
    completedDateTime?: {
      dateTime: string;
      timeZone: string;
    };
    dueDateTime?: {
      dateTime: string;
      timeZone: string;
    };
    startDateTime?: {
      dateTime: string;
      timeZone: string;
    };
    categories?: string[];
    createdDateTime?: string;
    hasAttachments?: boolean;
  }>;
