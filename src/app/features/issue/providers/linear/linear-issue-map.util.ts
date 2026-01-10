import { TaskAttachment } from 'src/app/features/tasks/task-attachment/task-attachment.model';
import { LinearAttachment, LinearIssueReduced } from './linear-issue.model';
import { DropPasteIcons } from 'src/app/core/drop-paste-input/drop-paste.model';

export const mapLinearAttachmentToTaskAttachment = (
  attachment: LinearAttachment,
): TaskAttachment => {
  return {
    id: attachment.id,
    title: attachment.title,
    path: attachment.url,
    type: 'LINK',
    icon: DropPasteIcons['LINK'], // Maybe this could use sourceType (github, slack)
  };
};

export const mapLinearIssueToSearchResult = (
  issue: LinearIssueReduced,
): { title: string } => ({
  title: `${issue.identifier} ${issue.title}`,
});

export const isLinearIssueDone = (issue: LinearIssueReduced): boolean =>
  issue.state.type === 'completed' || issue.state.type === 'canceled';
