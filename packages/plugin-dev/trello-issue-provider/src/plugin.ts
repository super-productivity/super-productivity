import type {
  IssueProviderPluginDefinition,
  PluginFieldMapping,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@super-productivity/plugin-api';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
  translate(key: string, params?: Record<string, string | number>): string;
};

const TRELLO_API = 'https://api.trello.com/1';

// Card fields fetched for list + detail views (kept identical to the built-in
// provider so behavior is unchanged after migration).
const CARD_FIELDS =
  'id,idShort,shortLink,name,url,desc,due,closed,idBoard,idList,dateLastActivity';
const MEMBER_FIELDS = 'fullName,username';
const ATTACHMENT_FIELDS = 'id,name,url,bytes,date,mimeType';
const BOARD_FIELDS = 'name,id';

interface TrelloConfig {
  apiKey?: string;
  token?: string;
  boardId?: string;
  boardName?: string;
  filterUsername?: string;
}

interface TrelloLabel {
  id: string;
  name: string;
  color: string | null;
}

interface TrelloMember {
  id: string;
  fullName: string;
  username: string;
}

interface TrelloAttachment {
  id: string;
  name: string;
  url: string;
}

interface TrelloCard {
  id: string;
  idShort: number | null;
  shortLink: string;
  name: string;
  desc: string;
  url: string;
  due: string | null;
  closed: boolean;
  idBoard: string;
  idList: string;
  dateLastActivity: string;
  labels?: TrelloLabel[];
  members?: TrelloMember[];
  attachments?: TrelloAttachment[];
}

interface TrelloSearchResponse {
  cards?: TrelloCard[];
}

interface TrelloBoard {
  id: string;
  name: string;
}

const t = (key: string): string => {
  try {
    return PluginAPI.translate(key);
  } catch {
    return key;
  }
};

const toMs = (date: string | null | undefined): number =>
  date ? new Date(date).getTime() : 0;

// Trello shows a per-board short id on cards; fall back to the shortLink.
const cardKey = (card: TrelloCard): string =>
  card.idShort !== null && card.idShort !== undefined
    ? String(card.idShort)
    : card.shortLink;

const dedupeByShortLink = (cards: TrelloCard[]): TrelloCard[] => {
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (!card.shortLink || seen.has(card.shortLink)) {
      return false;
    }
    seen.add(card.shortLink);
    return true;
  });
};

const mergeUniqueBoards = (boards: TrelloBoard[]): TrelloBoard[] => {
  const byId = new Map<string, TrelloBoard>();
  boards.forEach((board) => {
    if (board?.id && !byId.has(board.id)) {
      byId.set(board.id, board);
    }
  });
  return Array.from(byId.values());
};

// Auth is sent via Trello's documented `Authorization: OAuth` header rather than
// `key`/`token` URL query params, so credentials never appear in request URLs
// (and therefore never leak into error logs).
// Strip characters that would break out of the quoted OAuth params (or the
// header line); Trello keys/tokens are hex/alphanumeric so this never alters a
// valid credential — it's defense-in-depth against a mis-pasted value.
const cleanCred = (value: string | undefined): string =>
  (value || '').replace(/["\r\n]/g, '');

const trelloHeaders = (cfg: TrelloConfig): Record<string, string> => ({
  Authorization: `OAuth oauth_consumer_key="${cleanCred(cfg.apiKey)}", oauth_token="${cleanCred(
    cfg.token,
  )}"`,
});

const mapSearchResult = (card: TrelloCard): PluginSearchResult => {
  const key = cardKey(card);
  return {
    id: card.shortLink,
    title: `${key} ${card.name}`.trim(),
    url: card.url,
    status: card.closed ? 'closed' : 'open',
    lastUpdated: toMs(card.dateLastActivity),
  };
};

const mapIssue = (card: TrelloCard): PluginIssue => {
  const key = cardKey(card);
  const labels = (card.labels || []).map((l) => l.name).filter(Boolean);
  const members = (card.members || [])
    .map((m) => m.fullName || m.username)
    .filter(Boolean);
  const attachments = (card.attachments || []).filter((a) => !!a.url);
  const attachmentsMarkdown = attachments
    .map((a) => `[${a.name || a.url}](${a.url})`)
    .join('\n');

  return {
    id: card.shortLink,
    title: card.name,
    body: card.desc || '',
    url: card.url,
    state: card.closed ? 'closed' : 'open',
    lastUpdated: toMs(card.dateLastActivity),
    assignee: members.join(', '),
    labels,
    comments: [],

    // Extended fields for display + field mappings.
    key,
    summary: `${key} ${card.name}`.trim(),
    statusLabel: card.closed ? 'Closed' : 'Open',
    due: card.due || '',
    attachmentsMarkdown,
  };
};

const fetchBoardCards = async (
  cfg: TrelloConfig,
  http: PluginHttp,
  maxResults: number,
): Promise<TrelloCard[]> => {
  const limit = Math.min(Math.max(maxResults, 1), 500);
  const cards = await http.get<TrelloCard[]>(
    `${TRELLO_API}/boards/${cfg.boardId}/cards`,
    {
      params: {
        filter: 'open',
        limit: String(limit),
        fields: `${CARD_FIELDS},labels`,
        members: 'true',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        member_fields: MEMBER_FIELDS,
      },
    },
  );
  const arr = Array.isArray(cards) ? cards : [];
  return arr
    .slice()
    .sort((a, b) => toMs(b.dateLastActivity) - toMs(a.dateLastActivity))
    .slice(0, limit);
};

const resolveMemberId = async (
  username: string,
  http: PluginHttp,
): Promise<string | null> => {
  const res = await http.get<{ id: string }>(`${TRELLO_API}/members/${username}`, {
    params: { fields: 'id' },
  });
  return res?.id ?? null;
};

// --- Load boards for the config dropdown ---

const loadBoards = async (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> => {
  const cfg = config as unknown as TrelloConfig;
  if (!cfg.apiKey || !cfg.token) {
    return [];
  }

  // Every request is individually best-effort (`.catch(() => [])`): a
  // missing/forbidden organization must not break the member-board list.
  const memberBoards = await http
    .get<TrelloBoard[]>(`${TRELLO_API}/members/me/boards`, {
      params: { filter: 'open', fields: BOARD_FIELDS },
    })
    .catch(() => [] as TrelloBoard[]);

  const orgs = await http
    .get<{ id: string }[]>(`${TRELLO_API}/members/me/organizations`, {
      params: { fields: 'id' },
    })
    .catch(() => [] as { id: string }[]);
  const orgIds = Array.from(new Set((orgs || []).map((o) => o.id))).filter(Boolean);
  const orgBoards = await Promise.all(
    orgIds.map((id) =>
      http
        .get<TrelloBoard[]>(`${TRELLO_API}/organizations/${id}/boards`, {
          params: { filter: 'open', fields: BOARD_FIELDS },
        })
        .catch(() => [] as TrelloBoard[]),
    ),
  );

  const all = [...(memberBoards || []), ...orgBoards.flat()];
  return mergeUniqueBoards(all).map((b) => ({ label: b.name, value: b.id }));
};

PluginAPI.registerIssueProvider({
  configFields: [
    {
      key: 'apiKey',
      type: 'password',
      label: t('CFG.API_KEY'),
      description: t('CFG.API_KEY_DESC'),
      required: true,
    },
    {
      key: 'token',
      type: 'password',
      label: t('CFG.TOKEN'),
      description: t('CFG.TOKEN_DESC'),
      required: true,
    },
    {
      key: 'tokenHelp',
      type: 'link',
      label: t('CFG.HOW_TO_GET_TOKEN'),
      url: 'https://trello.com/power-ups/admin',
    },
    {
      key: 'boardId',
      type: 'select',
      label: t('CFG.BOARD'),
      description: t('CFG.BOARD_DESC'),
      required: true,
      loadOptions: loadBoards,
    },
    {
      key: 'filterUsername',
      type: 'input',
      label: t('CFG.FILTER_USERNAME'),
      description: t('CFG.FILTER_USERNAME_DESC'),
      advanced: true,
    },
  ],

  getHeaders(config: Record<string, unknown>): Record<string, string> {
    return trelloHeaders(config as unknown as TrelloConfig);
  },

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = config as unknown as TrelloConfig;
    const term = searchTerm.trim();

    if (!term) {
      const cards = await fetchBoardCards(cfg, http, 25);
      return dedupeByShortLink(cards).map(mapSearchResult);
    }

    const params: Record<string, string> = {
      query: term,
      modelTypes: 'cards',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      cards_limit: '25',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      card_fields: CARD_FIELDS,
      partial: 'true',
    };
    if (cfg.boardId) {
      params['idBoards'] = cfg.boardId;
    }

    const res = await http.get<TrelloSearchResponse>(`${TRELLO_API}/search`, { params });
    return dedupeByShortLink(res?.cards || []).map(mapSearchResult);
  },

  async getById(
    issueId: string,
    _config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const card = await http.get<TrelloCard>(`${TRELLO_API}/cards/${issueId}`, {
      params: {
        fields: `${CARD_FIELDS},labels`,
        attachments: 'true',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        attachment_fields: ATTACHMENT_FIELDS,
        members: 'true',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        member_fields: MEMBER_FIELDS,
      },
    });
    return mapIssue(card);
  },

  // The card id used throughout the app is the shortLink, which is exactly what
  // a Trello card URL is keyed on — so the link is derivable without a request.
  getIssueLink(issueId: string): string {
    return `https://trello.com/c/${issueId}`;
  },

  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    const cfg = config as unknown as TrelloConfig;
    try {
      await http.get(`${TRELLO_API}/boards/${cfg.boardId}`, {
        params: { fields: 'id' },
      });
      return true;
    } catch {
      return false;
    }
  },

  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = config as unknown as TrelloConfig;
    const cards = await fetchBoardCards(cfg, http, 200);

    if (cfg.filterUsername) {
      // Resolve the username to a member id and keep only their cards. If
      // resolution fails, fall back to importing all cards (matches built-in).
      const memberId = await resolveMemberId(cfg.filterUsername, http).catch(() => null);
      if (memberId) {
        return cards
          .filter((card) => (card.members || []).some((m) => m.id === memberId))
          .map(mapSearchResult);
      }
    }

    return cards.map(mapSearchResult);
  },

  issueDisplay: [
    { field: 'summary', label: t('DISPLAY.SUMMARY'), type: 'link', linkField: 'url' },
    { field: 'statusLabel', label: t('DISPLAY.STATUS'), type: 'text', hideEmpty: true },
    { field: 'due', label: t('DISPLAY.DUE_DATE'), type: 'text', hideEmpty: true },
    { field: 'labels', label: t('DISPLAY.LABELS'), type: 'list', hideEmpty: true },
    { field: 'assignee', label: t('DISPLAY.ASSIGNEE'), type: 'text', hideEmpty: true },
    {
      field: 'attachmentsMarkdown',
      label: t('DISPLAY.ATTACHMENTS'),
      type: 'markdown',
      hideEmpty: true,
    },
    { field: 'body', label: t('DISPLAY.DESCRIPTION'), type: 'markdown' },
  ],

  // Read-only provider: pull-only mapping drives remote-update detection only.
  // A Trello card counts as "done" once it is archived (closed).
  fieldMappings: [
    {
      taskField: 'isDone',
      issueField: 'state',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string => (taskValue ? 'closed' : 'open'),
      toTaskValue: (issueValue: unknown): boolean => issueValue === 'closed',
    },
  ] satisfies PluginFieldMapping[],

  extractSyncValues(issue: PluginIssue): Record<string, unknown> {
    return {
      state: issue.state,
      title: issue.title,
      body: issue.body,
    };
  },
} satisfies IssueProviderPluginDefinition as IssueProviderPluginDefinition);
