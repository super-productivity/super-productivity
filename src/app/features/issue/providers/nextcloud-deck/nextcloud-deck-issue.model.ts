export interface DeckLabel {
  id: number;
  title: string;
  color: string;
}

export interface DeckAssignedUser {
  participant: {
    uid: string;
    displayname: string;
  };
}

export type NextcloudDeckIssueReduced = Readonly<{
  id: number;
  title: string;
  stackId: number;
  stackTitle: string;
  lastModified: number;
  done: boolean;
  labels: DeckLabel[];
}>;

export type NextcloudDeckIssue = NextcloudDeckIssueReduced &
  Readonly<{
    description: string;
    duedate: string | null;
    assignedUsers: DeckAssignedUser[];
    boardId: number;
    order: number;
  }>;
