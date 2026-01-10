// Mapped Data Types
// -----------------
import { JiraOriginalComponent, JiraOriginalStatus } from './jira-api-responses';

export type JiraAuthor = Readonly<{
  id: string;
  name: string;
  key: string;
  accountId: string;
  emailAddress: string;
  avatarUrl: string;
  displayName: string;
  active: boolean;
  timeZone: string;
}>;

export type JiraAttachment = Readonly<{
  id: string;
  filename: string;
  created: string;
  size: number;
  mimeType: string;
  content: string;
  thumbnail?: string;
}>;

export type JiraComment = Readonly<{
  id: string;
  author: JiraAuthor;
  body: string;
  updateAuthor: JiraAuthor;
  created: string;
  update: string;
  jsdPublic: boolean;
}>;

export type JiraChangelogEntry = Readonly<{
  author: JiraAuthor | null;
  created: string;
  field: string;
  from: string;
  to: string;
}>;

// NOTE this is NOT equal to JiraIssueOriginalReduced

export type JiraIssueReduced = Readonly<{
  // copied data
  key: string;
  id: string;
  summary: string;
  components: JiraOriginalComponent[];
  timeestimate: number;
  timespent: number;
  description: string | null;

  updated: string;
  status: JiraOriginalStatus;

  // mapped data
  attachments: JiraAttachment[];
  assignee: JiraAuthor | null;

  // new properties (mapped)
  comments: JiraComment[];
  storyPoints?: number;
}>;

export type JiraSubtask = Readonly<{
  key: string;
  id: string;
  summary: string;
  // url needs to be calculated manually
}>;

export type JiraRelatedIssue = Readonly<{
  key: string;
  id: string;
  summary: string;
  relatedHow?: string;
  // url needs to be calculated manually
}>;

export type JiraIssue = JiraIssueReduced &
  Readonly<{
    changelog: JiraChangelogEntry[];
    subtasks: JiraSubtask[];
    relatedIssues: JiraRelatedIssue[];
  }>;
