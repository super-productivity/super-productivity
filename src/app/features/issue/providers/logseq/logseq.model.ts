import { BaseIssueProviderCfg } from '../../issue.model';

export type LogseqTaskWorkflow = 'NOW_LATER' | 'TODO_DOING';

export interface LogseqCfg extends BaseIssueProviderCfg {
  // Connection
  apiUrl: string | null;
  authToken: string | null;

  // Query
  queryFilter: string;

  // Sync
  isUpdateBlockOnTaskDone: boolean;
  linkFormat: 'logseq-url' | 'http-url';
  taskWorkflow: LogseqTaskWorkflow;

  // Reference
  superProdReferenceMode: 'property' | 'child-block' | 'none';
  superProdReferenceProperty: string;
}
