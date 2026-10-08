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

interface DeckConfig {
  nextcloudBaseUrl?: string;
  username?: string;
  password?: string;
  selectedBoardId?: string;
  importStackIds?: string[];
  doneStackId?: string;
  filterByAssignee?: boolean;
  titleTemplate?: string;
}

interface DeckLabel {
  id: number;
  title: string;
  color: string;
}

interface DeckAssignedUser {
  participant: { uid: string; displayname: string };
}

interface DeckBoard {
  id: number;
  title: string;
  archived: boolean;
}

interface DeckCard {
  id: number;
  title: string;
  description: string | null;
  duedate: string | null;
  // Unix timestamp in seconds. Kept as-is for issueLastUpdated so tasks created
  // by the built-in provider (which stored seconds) are not all flagged updated.
  lastModified: number;
  archived: boolean;
  // Deck returns a completion timestamp (or null), not a boolean (#8436)
  done: string | null;
  labels?: DeckLabel[];
  assignedUsers?: DeckAssignedUser[];
}

interface DeckStack {
  id: number;
  title: string;
  cards?: DeckCard[];
}

const STATE_DONE = 'done';
const STATE_OPEN = 'open';

const t = (key: string, params?: Record<string, string | number>): string => {
  try {
    return PluginAPI.translate(key, params);
  } catch {
    return key;
  }
};

const asCfg = (config: Record<string, unknown>): DeckConfig =>
  config as unknown as DeckConfig;

const getServerUrl = (cfg: DeckConfig): string =>
  (cfg.nextcloudBaseUrl || '').replace(/\/$/, '');

const getApiUrl = (cfg: DeckConfig): string =>
  `${getServerUrl(cfg)}/index.php/apps/deck/api/v1.0`;

// Legacy configs stored the board as a number; select fields store strings.
const getBoardId = (cfg: DeckConfig): string => {
  const id = cfg.selectedBoardId != null ? String(cfg.selectedBoardId) : '';
  if (!id) {
    throw new Error(t('ERRORS.NO_BOARD'));
  }
  return id;
};

// btoa only accepts Latin-1, so UTF-8 encode credentials first (non-ASCII passwords)
const toBase64 = (str: string): string => {
  let binary = '';
  for (const byte of new TextEncoder().encode(str)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const fetchStacks = (cfg: DeckConfig, http: PluginHttp): Promise<DeckStack[]> =>
  http.get<DeckStack[]>(`${getApiUrl(cfg)}/boards/${getBoardId(cfg)}/stacks`);

const formatTitle = (
  card: DeckCard,
  stack: DeckStack,
  cfg: DeckConfig,
  boardTitle: string,
): string => {
  const template = cfg.titleTemplate;
  if (!template) {
    return card.title;
  }
  return template
    .replace(/\{CARD_TITLE}/g, card.title)
    .replace(/\{COLUMN}/g, stack.title || '')
    .replace(/\{BOARD}/g, boardTitle)
    .replace(/\{ID}/g, String(card.id))
    .replace(/\{LABELS}/g, (card.labels || []).map((l) => l.title).join(', '));
};

// Only fetched when the title template needs it, to keep polling to one request.
const fetchBoardTitle = async (cfg: DeckConfig, http: PluginHttp): Promise<string> => {
  if (!cfg.titleTemplate?.includes('{BOARD}')) {
    return '';
  }
  const board = await http.get<DeckBoard>(`${getApiUrl(cfg)}/boards/${getBoardId(cfg)}`);
  return board?.title || '';
};

const mapCard = (
  card: DeckCard,
  stack: DeckStack,
  cfg: DeckConfig,
  boardTitle: string,
): PluginIssue & PluginSearchResult => ({
  id: String(card.id),
  title: formatTitle(card, stack, cfg, boardTitle),
  body: card.description || '',
  url: getCardLink(String(card.id), cfg),
  state: card.done ? STATE_DONE : STATE_OPEN,
  lastUpdated: card.lastModified,
  labels: (card.labels || []).map((l) => l.title),
  cardTitle: card.title,
  stackId: stack.id,
  stackTitle: stack.title,
  duedate: card.duedate || '',
  assignees: (card.assignedUsers || []).map((u) => u.participant.displayname).join(', '),
});

const isImportedStack = (stack: DeckStack, cfg: DeckConfig): boolean => {
  const importIds = (cfg.importStackIds || []).map(String);
  if (importIds.length && !importIds.includes(String(stack.id))) {
    return false;
  }
  return !cfg.doneStackId || String(cfg.doneStackId) !== String(stack.id);
};

const isOpenCardForUser = (card: DeckCard, cfg: DeckConfig): boolean => {
  if (card.archived || card.done) {
    return false;
  }
  if (cfg.filterByAssignee && cfg.username) {
    return !!card.assignedUsers?.some((u) => u.participant.uid === cfg.username);
  }
  return true;
};

const fetchOpenCards = async (
  cfg: DeckConfig,
  http: PluginHttp,
): Promise<PluginSearchResult[]> => {
  const [stacks, boardTitle] = await Promise.all([
    fetchStacks(cfg, http),
    fetchBoardTitle(cfg, http),
  ]);
  return stacks
    .filter((stack) => isImportedStack(stack, cfg))
    .flatMap((stack) =>
      (stack.cards || [])
        .filter((card) => isOpenCardForUser(card, cfg))
        .map((card) => mapCard(card, stack, cfg, boardTitle)),
    );
};

const findCard = async (
  cardId: string,
  cfg: DeckConfig,
  http: PluginHttp,
): Promise<{ card: DeckCard; stack: DeckStack }> => {
  const stacks = await fetchStacks(cfg, http);
  for (const stack of stacks) {
    const card = (stack.cards || []).find((c) => String(c.id) === cardId);
    if (card) {
      return { card, stack };
    }
  }
  throw new Error(t('ERRORS.CARD_NOT_FOUND'));
};

function getCardLink(cardId: string, cfg: DeckConfig): string {
  const boardId = cfg.selectedBoardId != null ? String(cfg.selectedBoardId) : '';
  return boardId ? `${getServerUrl(cfg)}/apps/deck/board/${boardId}/card/${cardId}` : '';
}

const loadStackOptions = async (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> => {
  const cfg = asCfg(config);
  if (!cfg.selectedBoardId) {
    return [];
  }
  const stacks = await fetchStacks(cfg, http);
  return stacks.map((s) => ({ label: s.title, value: String(s.id) }));
};

PluginAPI.registerIssueProvider({
  configFields: [
    {
      key: 'nextcloudBaseUrl',
      type: 'input',
      label: t('CFG.BASE_URL'),
      required: true,
      pattern: '^(http(s)?:\\/\\/)?([\\w\\-]+(?:\\.[\\w\\-]+)*)(:\\d+)?(\\/\\S*)?$',
    },
    { key: 'username', type: 'input', label: t('CFG.USERNAME'), required: true },
    { key: 'password', type: 'password', label: t('CFG.PASSWORD'), required: true },
    {
      key: 'selectedBoardId',
      type: 'select',
      label: t('CFG.BOARD'),
      required: true,
      async loadOptions(config, http) {
        const cfg = asCfg(config);
        const boards = await http.get<DeckBoard[]>(`${getApiUrl(cfg)}/boards`);
        return boards
          .filter((b) => !b.archived)
          .map((b) => ({ label: b.title, value: String(b.id) }));
      },
    },
    {
      key: 'importStackIds',
      type: 'multiSelect',
      label: t('CFG.IMPORT_STACKS'),
      description: t('CFG.STACKS_DESC'),
      loadOptions: loadStackOptions,
    },
    {
      key: 'doneStackId',
      type: 'select',
      label: t('CFG.DONE_STACK'),
      description: t('CFG.STACKS_DESC'),
      async loadOptions(config, http) {
        const options = await loadStackOptions(config, http);
        // A plain select cannot be cleared, so offer an explicit "none"
        return options.length ? [{ label: t('CFG.NONE'), value: '' }, ...options] : [];
      },
    },
    {
      key: 'filterByAssignee',
      type: 'checkbox',
      label: t('CFG.FILTER_BY_ASSIGNEE'),
      advanced: true,
    },
    {
      key: 'titleTemplate',
      type: 'input',
      label: t('CFG.TITLE_TEMPLATE'),
      description: t('CFG.TITLE_TEMPLATE_DESC'),
      advanced: true,
    },
  ],

  getHeaders(config: Record<string, unknown>): Record<string, string> {
    const cfg = asCfg(config);
    return {
      Authorization: `Basic ${toBase64(`${cfg.username || ''}:${cfg.password || ''}`)}`,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
    };
  },

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    // Deck has no search endpoint, so filter the board's open cards locally
    const term = searchTerm.toLowerCase();
    const cards = await fetchOpenCards(asCfg(config), http);
    return cards.filter((c) => String(c['cardTitle']).toLowerCase().includes(term));
  },

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const cfg = asCfg(config);
    const [{ card, stack }, boardTitle] = await Promise.all([
      findCard(issueId, cfg, http),
      fetchBoardTitle(cfg, http),
    ]);
    return mapCard(card, stack, cfg, boardTitle);
  },

  // Deck has no single-card endpoint, so a refresh reads the board once
  async getByIds(
    issueIds: string[],
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue[]> {
    const cfg = asCfg(config);
    const ids = new Set(issueIds);
    const [stacks, boardTitle] = await Promise.all([
      fetchStacks(cfg, http),
      fetchBoardTitle(cfg, http),
    ]);
    return stacks.flatMap((stack) =>
      (stack.cards || [])
        .filter((card) => ids.has(String(card.id)))
        .map((card) => mapCard(card, stack, cfg, boardTitle)),
    );
  },

  getIssueLink(issueId: string, config: Record<string, unknown>): string {
    return getCardLink(issueId, asCfg(config));
  },

  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    try {
      const boards = await http.get(`${getApiUrl(asCfg(config))}/boards`);
      return Array.isArray(boards);
    } catch {
      return false;
    }
  },

  getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    return fetchOpenCards(asCfg(config), http);
  },

  issueDisplay: [
    { field: 'title', label: t('DISPLAY.SUMMARY'), type: 'link', linkField: 'url' },
    { field: 'body', label: t('DISPLAY.DESCRIPTION'), type: 'markdown', hideEmpty: true },
    { field: 'stackTitle', label: t('DISPLAY.STACK'), type: 'text' },
    { field: 'duedate', label: t('DISPLAY.DUE_DATE'), type: 'text', hideEmpty: true },
    {
      field: 'assignees',
      label: t('DISPLAY.ASSIGNED_USERS'),
      type: 'text',
      hideEmpty: true,
    },
    { field: 'labels', label: t('DISPLAY.LABELS'), type: 'list', hideEmpty: true },
  ],

  fieldMappings: [
    {
      taskField: 'isDone',
      issueField: 'state',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string => (taskValue ? STATE_DONE : STATE_OPEN),
      toTaskValue: (issueValue: unknown): boolean => issueValue === STATE_DONE,
    },
    {
      taskField: 'notes',
      issueField: 'body',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
      toTaskValue: (issueValue: unknown): string => (issueValue as string) ?? '',
    },
  ] satisfies PluginFieldMapping[],

  // Deck's card update is a full PUT, so the current card is read first and
  // only the changed fields are replaced.
  async updateIssue(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void> {
    const cfg = asCfg(config);
    const boardId = getBoardId(cfg);
    const { card, stack } = await findCard(id, cfg, http);
    const isMarkedDone = changes['state'] === STATE_DONE;
    const doneStackId = cfg.doneStackId ? String(cfg.doneStackId) : '';
    let stackId = String(stack.id);

    if (isMarkedDone && doneStackId && doneStackId !== stackId) {
      await http.put(
        `${getApiUrl(cfg)}/boards/${boardId}/stacks/${stackId}/cards/${id}/reorder`,
        { stackId: Number(doneStackId), order: 0 },
      );
      stackId = doneStackId;
    }

    await http.put(`${getApiUrl(cfg)}/boards/${boardId}/stacks/${stackId}/cards/${id}`, {
      type: 'plain',
      owner: cfg.username,
      title: card.title,
      description: 'body' in changes ? changes['body'] : (card.description ?? ''),
      duedate: card.duedate,
      done:
        'state' in changes ? (isMarkedDone ? new Date().toISOString() : null) : card.done,
    });
  },

  extractSyncValues(issue: PluginIssue): Record<string, unknown> {
    return {
      state: issue.state,
      body: issue.body,
    };
  },
} satisfies IssueProviderPluginDefinition as IssueProviderPluginDefinition);
