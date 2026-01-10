export type LinearIssueReduced = Readonly<{
  id: string;
  identifier: string;
  number: number;
  title: string;
  state: {
    name: string;
    type: string;
  };
  updatedAt: string;
  url: string;
}>;

export type LinearIssue = LinearIssueReduced &
  Readonly<{
    description?: string;
    priority: number;
    createdAt: string;
    completedAt?: string | null;
    canceledAt?: string | null;
    dueDate?: string | null;
    assignee?: {
      id: string;
      name: string;
      email: string;
      avatarUrl?: string;
    } | null;
    creator: {
      id: string;
      name: string;
    };
    team: {
      id: string;
      name: string;
      key: string;
    };
    labels: Array<{
      id: string;
      name: string;
      color: string;
    }>;
    comments: LinearComment[];
    attachments: LinearAttachment[];
  }>;

export type LinearComment = Readonly<{
  id: string;
  body: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
}>;

export type LinearAttachment = Readonly<{
  id: string;
  sourceType: string;
  title: string;
  url: string;
}>;
