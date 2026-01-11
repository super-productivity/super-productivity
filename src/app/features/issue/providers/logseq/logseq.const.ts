import { LogseqCfg } from './logseq.model';

export const DEFAULT_LOGSEQ_CFG: LogseqCfg = {
  isEnabled: false,
  apiUrl: 'http://localhost:12315/api',
  authToken: null,
  queryFilter:
    '[:find (pull ?b [*]) :where [?b :block/marker ?m] [(contains? #{"TODO" "DOING"} ?m)]]',
  isUpdateBlockOnTaskDone: true,
  linkFormat: 'logseq-url',
  taskWorkflow: 'TODO_DOING',
  superProdReferenceMode: 'property',
  superProdReferenceProperty: 'superProductivity',
};

export const LOGSEQ_POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes
export const LOGSEQ_TYPE /* : IssueProviderKey */ = 'LOGSEQ';
export const LOGSEQ_SEARCH_WILDCARD = '*'; // Shows all tasks

// Form config will be exported after it's created
export { LOGSEQ_CONFIG_FORM_SECTION } from './logseq-cfg-form.const';
