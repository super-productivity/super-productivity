import { LogseqCfg } from './logseq.model';

export const DEFAULT_LOGSEQ_CFG: LogseqCfg = {
  isEnabled: false,
  apiUrl: 'http://localhost:12315/api',
  authToken: null,
  queryFilter:
    '[:find (pull ?b [*]) :where [?b :block/marker ?m] [(contains? #{"TODO" "DOING" "LATER" "NOW"} ?m)]]',
  isUpdateBlockOnTaskDone: true,
  linkFormat: 'logseq-url',
  taskWorkflow: 'TODO_DOING',
  superProdReferenceMode: 'property',
  superProdReferenceProperty: 'superProductivity',
};

export const LOGSEQ_POLL_INTERVAL = 0.5 * 60 * 1000; // half a minute (it's usually local)
export const LOGSEQ_TYPE /* : IssueProviderKey */ = 'LOGSEQ';

// Form config will be exported after it's created
export {
  LOGSEQ_CONFIG_FORM_SECTION,
  LOGSEQ_SEARCH_WILDCARD,
} from './logseq-cfg-form.const';
