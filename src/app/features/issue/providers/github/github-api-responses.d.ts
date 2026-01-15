export type GithubOriginalState = 'open' | 'closed' | 'all';

export type GithubOriginalUser = Readonly<{
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  gravatar_id: string;
  url: string;
  html_url: string;
  followers_url: string;
  following_url: string;
  gists_url: string;
  starred_url: string;
  subscriptions_url: string;
  organizations_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  type: 'User';
  site_admin: boolean;
}>;
export type GithubOriginalLabel = Readonly<{
  id: number;
  node_id: string;
  url: string;
  name: string;
  description: string;
  color: string;
  default: boolean;
}>;

export type GithubOriginalMileStone = Readonly<{
  url: string;
  html_url: string;
  labels_url: string;
  id: number;
  node_id: string;

  number: number;
  state: GithubOriginalState;
  title: string;
  description: string;
  creator: GithubOriginalUser;
  open_issues: number;
  closed_issues: number;
  created_at: string;
  updated_at: string;
  closed_at: string;
  due_on: string;
}>;

export type GithubOriginalPullRequest = Readonly<{
  url: string;
  html_url: string;
  diff_url: string;
  patch_url: string;
}>;

export type GithubOriginalPermissions = Readonly<{
  admin: boolean;
  push: boolean;
  pull: boolean;
}>;

export type GithubOriginalRepository = Readonly<{
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner: GithubOriginalUser;
  private: boolean;
  html_url: string;
  description: string;
  fork: boolean;
  url: string;
  archive_url: string;
  assignees_url: string;
  blobs_url: string;
  branches_url: string;
  collaborators_url: string;
  comments_url: string;
  commits_url: string;
  compare_url: string;
  contents_url: string;
  contributors_url: string;
  deployments_url: string;
  downloads_url: string;
  events_url: string;
  forks_url: string;
  git_commits_url: string;
  git_refs_url: string;
  git_tags_url: string;
  git_url: string;
  issue_comment_url: string;
  issue_events_url: string;
  issues_url: string;
  keys_url: string;
  labels_url: string;
  languages_url: string;
  merges_url: string;
  milestones_url: string;
  notifications_url: string;
  pulls_url: string;
  releases_url: string;
  ssh_url: string;
  stargazers_url: string;
  statuses_url: string;
  subscribers_url: string;
  subscription_url: string;
  tags_url: string;
  teams_url: string;
  trees_url: string;
  clone_url: string;
  mirror_url: string;
  hooks_url: string;
  svn_url: string;
  homepage: string;
  language: null;
  forks_count: number;
  stargazers_count: number;
  watchers_count: number;
  size: number;
  default_branch: string;
  open_issues_count: number;
  topics: string[];
  has_issues: boolean;
  has_projects: boolean;
  has_wiki: boolean;
  has_pages: boolean;
  has_downloads: boolean;
  archived: boolean;
  pushed_at: string;
  created_at: string;
  updated_at: string;
  permissions: GithubOriginalPermissions;
  allow_rebase_merge: boolean;
  allow_squash_merge: boolean;
  allow_merge_commit: boolean;
  subscribers_count: number;
  network_count: number;
}>;

export type GithubOriginalIssue = Readonly<{
  id: number;
  node_id: string;
  url: string;
  repository_url: string;
  labels_url: string;
  comments_url: string;
  events_url: string;
  html_url: string;

  number: number;
  state: GithubOriginalState;
  title: string;
  body: string;
  user: GithubOriginalUser;
  labels: GithubOriginalLabel[];
  assignee: GithubOriginalUser;
  assignees: GithubOriginalUser[];
  milestone: GithubOriginalMileStone;
  locked: boolean;
  active_lock_reason: string;
  comments: number;
  pull_request: GithubOriginalPullRequest;
  closed_at: string;
  created_at: string;
  updated_at: string;
  repository: GithubOriginalRepository;
}>;

export type GithubOriginalComment = Readonly<{
  author_association: string;
  body: string;
  created_at: string;
  html_url: string;
  id: number;
  issue_url: string;
  node_id: string;
  updated_at: string;
  url: string;
  user: GithubOriginalUser;
}>;

export type GithubIssueSearchResult = Readonly<{
  total_count: number;
  incomplete_results: boolean;
  items: GithubOriginalIssue[];
}>;
