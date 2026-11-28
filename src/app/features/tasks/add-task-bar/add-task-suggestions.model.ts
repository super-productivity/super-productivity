import { IssueData, IssueProviderKey } from '../../issue/issue.model';
import { Tag } from '../../tag/tag.model';
import { Project } from '../../project/project.model';

export interface AddTaskSuggestion {
  title: string;

  // all issue types
  issueType?: IssueProviderKey;
  issueData?: IssueData;
  issueProviderId?: string;

  // issue only
  titleHighlighted?: string;

  // task only
  taskId?: string;
  taskIssueId?: string;
  isFromOtherContextAndTagOnlySearch?: boolean;

  // for add from tag context only
  ctx?: Tag | Project;
  tagIds?: string[];
  projectId: string;
}
