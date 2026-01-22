import { LogseqCfg } from './logseq.model';

export const DEFAULT_LOGSEQ_CFG: LogseqCfg = {
  isEnabled: false,
  apiUrl: 'http://localhost:12315/api',
  authToken: null,
  queryFilter:
    '[:find (pull ?b [*]) :where [?b :block/marker ?m] [(contains? #{"TODO" "DOING" "LATER" "NOW"} ?m)]]',
  isIncludeMarkerInUpdateDetection: false,
  linkFormat: 'logseq-url',
  taskWorkflow: 'TODO_DOING',
};

export const LOGSEQ_POLL_INTERVAL = 0.5 * 60 * 1000; // half a minute (it's usually local)
export const LOGSEQ_TYPE /* : IssueProviderKey */ = 'LOGSEQ';

// Valid Logseq task markers
export const LOGSEQ_MARKERS = [
  'TODO',
  'DONE',
  'DOING',
  'LATER',
  'WAITING',
  'NOW',
] as const;
export type LogseqMarker = (typeof LOGSEQ_MARKERS)[number];

// Regex to match and remove marker prefix from content
export const LOGSEQ_MARKER_REGEX = /^(TODO|DONE|DOING|LATER|WAITING|NOW)\s+/i;

// Form config will be exported after it's created
export {
  LOGSEQ_CONFIG_FORM_SECTION,
  LOGSEQ_SEARCH_WILDCARD,
} from './logseq-cfg-form.const';
