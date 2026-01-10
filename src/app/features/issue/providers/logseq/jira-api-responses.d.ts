// CHECK SWAGGER EXPORT IF MORE ARE NEEDED!!!
/* eslint-disable @typescript-eslint/naming-convention */

// Standard API responses
export type JiraOriginalComponent = Readonly<{
  self: string;
  id: string;
  summary: string;
  name: string;
  description: string;
}>;

export type JiraOriginalAvatarUrls = Readonly<{
  '16x16': string;
  '24x24': string;
  '32x32': string;
  '48x48': string;
}>;

export type JiraOriginalAuthor = Readonly<{
  self: string;
  id: string;
  name: string;
  key: string;
  accountId: string;
  emailAddress: string;
  avatarUrls: JiraOriginalAvatarUrls;
  displayName: string;
  active: boolean;
  timeZone: string;
}>;

export interface JiraOriginalUser extends JiraOriginalAuthor {
  expand: string;
  locale: string;
  groups: {
    items: any[];
    size: number;
  };
  applicationRoles: {
    items: any[];
    size: number;
  };
}

export type JiraOriginalAttachment = Readonly<{
  self: string;
  id: string;
  filename: string;
  author: JiraOriginalAuthor;
  created: string;
  size: number;
  mimeType: string;
  content: string;
  thumbnail?: string;
}>;

export interface JiraOriginalIssueLinkType {
  id?: string;
  name?: string;
  inward?: string;
  outward?: string;
  readonly self?: string;
}

export interface JiraOriginalLinkedIssue {
  id: string;
  key: string;
  readonly self: string;
  readonly fields: JiraOriginalFields;
}

export interface JiraOriginalIssueLink {
  readonly id?: string;
  readonly self?: string;
  type: JiraOriginalIssueLinkType;
  inwardIssue?: JiraOriginalLinkedIssue;
  outwardIssue?: JiraOriginalLinkedIssue;
}

export type JiraOriginalComment = Readonly<{
  self: string;
  id: string;
  author: JiraOriginalAuthor;
  body: string;
  updateAuthor: JiraOriginalAuthor;
  created: string;
  update: string;
  jsdPublic: boolean;
}>;

export type JiraOriginalCategory = Readonly<{
  self: string;
  id: string;
  key: string;
  colorName: string;
  name: string;
}>;

export type JiraOriginalStatus = Readonly<{
  self: string;
  id: string;
  description: string;
  iconUrl: string;
  name: string;
  statusCategory: JiraOriginalCategory;
}>;

export type JiraOriginalFields = Readonly<{
  summary: string;
  components: JiraOriginalComponent[];
  attachment: JiraOriginalAttachment[];
  timeestimate: number;
  timespent: number;
  description: string | null;
  subtasks?: JiraIssueOriginalSubtask[];
  comment?: {
    comments: JiraOriginalComment[];
    maxResults: number;
    total: number;
    startAt: number;
  };
  assignee: JiraOriginalAuthor;
  updated: string;
  status: JiraOriginalStatus;
  issuelinks: JiraOriginalIssueLink[];
}>;

// export type JiraIssueOriginalReduced = Readonly<{
//   key: string;
//   id: string;
//   expand: string;
//   self: string;
//   fields: JiraOriginalFields;
//   changelog?: JiraOriginalChangelog;
// }>;

export type JiraOriginalChangelog = Readonly<{
  histories: {
    author: JiraOriginalAuthor;
    created: string;
    id: string;
    items: {
      field: string;
      fieldId: string;
      fieldtype: string;
      from: any;
      fromString: string;
      to: any;
      toString: string;
    }[];
  }[];
  maxResults: number;
  startAt: number;
  total: number;
}>;

export type JiraOriginalTransition = Readonly<{
  id: string;
  name: string;
  to: {
    self: string;
    description: string;
    iconUrl: string;
    name: string;
    id: string;
    statusCategory: {
      self: string;
      id: number;
      key: string;
      colorName: string;
      name: string;
    };
  };
  hasScreen: boolean;
  isGlobal: boolean;
  isInitial: boolean;
  isConditional: boolean;
  fields: Record<string, unknown>;
}>;

export type JiraIssueOriginal = Readonly<{
  key: string;
  id: string;
  expand: string;
  self: string;
  fields: JiraOriginalFields;
  changelog?: JiraOriginalChangelog;
}>;

export type JiraIssueOriginalSubtask = Omit<
  JiraIssueOriginal,
  'expand' | 'changelog' | 'subtasks'
>;
