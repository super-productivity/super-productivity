import { GitlabIssue } from './gitlab-issue.model';
import { GitlabOriginalIssue } from './gitlab-api/gitlab-api-responses';
import { IssueProviderKey, SearchResultItem } from '../../issue.model';
import { GitlabCfg } from './gitlab.model';

export const mapGitlabIssue = (
  issue: GitlabOriginalIssue,
  cfg: GitlabCfg,
): GitlabIssue => {
  return {
    html_url: issue.web_url,

    number: issue.iid,
    // iid: issue.iid,
    state: issue.state,
    title: issue.title,
    body: issue.description,
    user: issue.author,
    labels: issue.labels,
    assignee: issue.assignee,
    milestone: issue.milestone as any,
    closed_at: issue.closed_at,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    due_date: issue.due_date,

    // added
    wasUpdated: false,
    commentsNr: issue.user_notes_count,
    // _id: issue.id,

    // transformed
    comments: [],
    url: issue.web_url,
    // NOTE: we use the issue number as id as well, as it there is not much to be done with the id with the api
    // when we can get issues from multiple projects we use full reference as id
    // also @see below
    // e.g.: johannesjo/test-repo#44
    id: issue.references.full,
    links: issue._links,
  };
};

/* Explanation:
 * We're doing this, since the id property is something only admins can use and more of an internal GitLab thing.
 * Since iid is just a number that is counted up, we use issue.reference.full which translates to
 * "johannesjo/test-repo#44"
 * */
export const getPartsFromGitlabIssueId = (
  issueId: string,
): { project: string; projectIssueId: string } => {
  const parts = issueId.split('#');
  const project = parts[0];
  const projectIssueId = parts[1];

  if (!project || !projectIssueId) {
    throw new Error('Cannot parse GitLab project and issueId');
  }

  return {
    project,
    projectIssueId,
  };
};

// export const getGitlabFullIssueRef = (
//   issue: string | number,
//   projectConfig: GitlabCfg,
// ): string => {
//   if (getPartsFromGitlabIssueUrl(issue).length === 2) {
//     return issue.toString();
//   } else {
//     return this.getProject(projectConfig, issue) + '#' + this._getIidFromIssue(issue);
//   }
// };

export const mapGitlabIssueToSearchResult = (issue: GitlabIssue): SearchResultItem => {
  return {
    title: '#' + issue.id + ' ' + issue.title,
    issueType: 'GITLAB' as IssueProviderKey,
    issueData: issue,
  };
};
