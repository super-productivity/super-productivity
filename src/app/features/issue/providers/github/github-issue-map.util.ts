import { GithubIssue, GithubIssueReduced } from './github-issue.model';
import { GithubOriginalIssue } from './github-api-responses';
import { SearchResultItem } from '../../issue.model';

export const mapGithubIssue = (issue: GithubOriginalIssue): GithubIssue => {
  return {
    id: issue.number,
    _id: issue.id,
    // NOTE: url: issue.url,
    url: issue.html_url,
    repository_url: issue.repository_url,
    labels_url: issue.labels_url,
    comments_url: issue.comments_url,
    events_url: issue.events_url,
    html_url: issue.html_url,

    number: issue.number,
    state: issue.state,
    title: issue.title,
    body: issue.body,
    user: issue.user,
    labels: issue.labels,
    assignee: issue.assignee,
    milestone: issue.milestone,
    locked: issue.locked,
    active_lock_reason: issue.active_lock_reason,
    pull_request: issue.pull_request,
    closed_at: issue.closed_at,
    created_at: issue.created_at,
    updated_at: issue.updated_at,

    // new
    commentsNr: issue.comments,
    apiUrl: issue.url,

    // transformed
    comments: [],
  };
};

export const mapGithubGraphQLSearchResult = (res: any): GithubIssueReduced[] => {
  return res.data.repository.issues.edges.map(mapGithubReducedIssueFromGraphQL);
};

export const mapGithubReducedIssueFromGraphQL = ({ node }: any): GithubIssueReduced => {
  return {
    id: node.number,
    number: node.number,
    title: node.title,
    state: node.state,
    updated_at: node.updatedAt,
  };
};

export const mapGithubIssueToSearchResult = (
  issue: GithubIssueReduced,
): SearchResultItem<'GITHUB'> => {
  return {
    title: '#' + issue.number + ' ' + issue.title,
    issueType: 'GITHUB',
    issueData: issue,
  };
};
