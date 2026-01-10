import {
  JiraAttachment,
  JiraAuthor,
  JiraChangelogEntry,
  JiraComment,
  JiraIssue,
  JiraRelatedIssue,
  JiraSubtask,
} from './jira-issue.model';
import {
  JiraIssueOriginal,
  JiraIssueOriginalSubtask,
  JiraOriginalAttachment,
  JiraOriginalAuthor,
  JiraOriginalChangelog,
  JiraOriginalComment,
  JiraOriginalIssueLink,
  JiraOriginalLinkedIssue,
} from './jira-api-responses';
import { JiraCfg } from './jira.model';
import {
  DropPasteIcons,
  DropPasteInputType,
} from '../../../../core/drop-paste-input/drop-paste.model';
import { IssueProviderKey, SearchResultItem } from '../../issue.model';
import { TaskAttachment } from '../../../tasks/task-attachment/task-attachment.model';
import { dedupeByKey } from '../../../../util/de-dupe-by-key';
import { JIRA_TYPE } from '../../issue.const';
import { IssueLog } from '../../../../core/log';

export const mapToSearchResults = (res: any): SearchResultItem[] => {
  IssueLog.log(res);

  const issues = dedupeByKey(
    res.response.sections.map((sec: any) => sec.issues).flat(),
    'key',
  ).map((issue: any) => {
    return {
      title: issue.key + ' ' + issue.summaryText,
      titleHighlighted: issue.key + ' ' + issue.summary,
      issueType: JIRA_TYPE as IssueProviderKey,
      issueData: {
        ...issue,
        summary: issue.summaryText,
        // NOTE: we always use the key, because it allows us to create the right link
        id: issue.key,
      },
    };
  });
  return issues;
};

export const mapToSearchResultsForJQL = (res: any): SearchResultItem[] => {
  IssueLog.log(res);

  const issues = dedupeByKey(res.response.issues, 'key').map((issue: any) => {
    return {
      title: issue.key + ' ' + issue.summaryText,
      titleHighlighted: issue.key + ' ' + issue.summary,
      issueType: JIRA_TYPE as IssueProviderKey,
      issueData: {
        ...issue,
        summary: issue.summaryText,
        // NOTE: we always use the key, because it allows us to create the right link
        id: issue.key,
      },
    };
  });
  return issues;
};

export const mapIssuesResponse = (res: any, cfg: JiraCfg): JiraIssue[] => {
  return res.response.issues.map((issue: JiraIssueOriginal) => {
    return mapIssue(issue, cfg);
  });
};

export const mapResponse = (res: any): unknown => res.response;

export const mapIssueResponse = (res: any, cfg: JiraCfg): JiraIssue =>
  mapIssue(res.response, cfg);

export const mapIssue = (issue: JiraIssueOriginal, cfg: JiraCfg): JiraIssue => {
  const issueCopy = Object.assign({}, issue);
  const fields = issueCopy.fields;
  IssueLog.log(fields);

  return {
    key: issueCopy.key,
    // NOTE: we always use the key, because it allows us to create the right link
    id: issueCopy.key,
    components: fields.components,
    timeestimate: fields.timeestimate,
    timespent: fields.timespent,
    description: fields.description,
    summary: fields.summary,
    updated: fields.updated,
    status: fields.status,
    storyPoints:
      !!cfg.storyPointFieldId && !!(fields as any)[cfg.storyPointFieldId]
        ? ((fields as any)[cfg.storyPointFieldId] as number)
        : undefined,
    attachments: fields.attachment && fields.attachment.map(mapAttachment),
    comments:
      !!fields.comment && !!fields.comment.comments
        ? fields.comment.comments.map(mapComments)
        : [],
    changelog: mapChangelog(issueCopy.changelog as JiraOriginalChangelog),
    assignee: mapAuthor(fields.assignee, true),
    subtasks: fields.subtasks?.length ? mapSubTasks(fields.subtasks) : [],
    relatedIssues: fields.issuelinks?.length ? mapIssueLinks(fields.issuelinks) : [],
    // url: makeIssueUrl(cfg.host, issueCopy.key)
  };
};

const mapIssueLinks = (issueLinks: JiraOriginalIssueLink[]): JiraRelatedIssue[] => {
  IssueLog.log(issueLinks);

  return issueLinks.map((il) => {
    const isInwardIssue = !!il.inwardIssue;
    const relatedIssue = (il.inwardIssue || il.outwardIssue) as JiraOriginalLinkedIssue;
    return {
      id: relatedIssue.id as string,
      key: relatedIssue.key as string,
      relatedHow: isInwardIssue ? il.type.inward : il.type.outward,
      summary: relatedIssue.fields.summary,
    };
  });
};

const mapSubTasks = (subtasks: JiraIssueOriginalSubtask[]): JiraSubtask[] => {
  return subtasks.map((st) => ({
    id: st.id,
    key: st.key,
    summary: st.fields.summary,
  }));
};

export const mapAuthor = (
  author: JiraOriginalAuthor,
  isOptional: boolean = false,
): JiraAuthor | null => {
  if (!author) {
    return null;
  }
  return Object.assign({}, author, {
    self: undefined,
    avatarUrls: undefined,
    avatarUrl: author.avatarUrls['48x48'],
  });
};
export const mapAttachment = (attachment: JiraOriginalAttachment): JiraAttachment => {
  return Object.assign({}, attachment, {
    self: undefined,
    author: undefined,
  });
};
export const mapComments = (comment: JiraOriginalComment): JiraComment => {
  return Object.assign({}, comment, {
    self: undefined,
    updateAuthor: undefined,
    author: mapAuthor(comment.author),
  });
};

export const mapJiraAttachmentToAttachment = (
  jiraAttachment: JiraAttachment,
): TaskAttachment => {
  const type = mapAttachmentType(jiraAttachment.mimeType);
  return {
    id: null,
    title: jiraAttachment.filename,
    path: jiraAttachment.thumbnail || jiraAttachment.content,
    originalImgPath: jiraAttachment.content,
    type,
    icon: DropPasteIcons[type],
  };
};

export const mapChangelog = (changelog: JiraOriginalChangelog): JiraChangelogEntry[] => {
  const newChangelog: JiraChangelogEntry[] = [];
  if (!changelog) {
    return [];
  }

  changelog.histories.forEach((entry) => {
    entry.items.forEach((item) => {
      newChangelog.push({
        author: mapAuthor(entry.author, true),
        created: entry.created,
        field: item.field,
        from: item.fromString,
        to: item.toString,
      });
    });
  });
  return newChangelog;
};

export const mapTransitionResponse = (res: any): unknown => res.response.transitions;

const mapAttachmentType = (mimeType: string): DropPasteInputType => {
  switch (mimeType) {
    case 'image/gif':
    case 'image/jpeg':
    case 'image/png':
      return 'IMG';

    default:
      return 'LINK';
  }
};
