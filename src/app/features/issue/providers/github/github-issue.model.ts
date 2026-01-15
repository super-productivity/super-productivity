import {
  GithubOriginalComment,
  GithubOriginalLabel,
  GithubOriginalMileStone,
  GithubOriginalPullRequest,
  GithubOriginalState,
  GithubOriginalUser,
} from './github-api-responses';

export type GithubState = GithubOriginalState;
export type GithubUser = GithubOriginalUser;
export type GithubLabel = GithubOriginalLabel;
export type GithubMileStone = GithubOriginalMileStone;
export type GithubPullRequest = GithubOriginalPullRequest;
export type GithubComment = GithubOriginalComment;

export type GithubIssueReduced = Readonly<{
  state: GithubState;
  title: string;
  // to make it consistent with non reduced issue
  updated_at: string;

  // NOTE: we use the issue number as id as well, as it there is not much to be done with the id with the api
  id: number;
  number: number;

  // removed
  // node_id: string;
  // assignees: GithubOriginalUser[];
  // repository: GithubOriginalRepository;
}>;

export type GithubIssue = GithubIssueReduced &
  Readonly<{
    number: number;
    repository_url: string;
    labels_url: string;
    comments_url: string;
    events_url: string;
    html_url: string;
    body: string;
    labels: GithubLabel[];
    milestone: GithubMileStone;
    locked: boolean;
    active_lock_reason: string;
    pull_request: GithubPullRequest;
    closed_at: string;
    created_at: string;
    user: GithubUser;
    assignee: GithubUser;

    // added TODO check if we can remove them
    commentsNr: number;
    apiUrl: string;
    _id: number;

    // transformed
    url: string;

    // added via extra request??
    comments: GithubComment[];
  }>;
