import { describe, it, expect, beforeAll, vi } from 'vitest';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
} from '@super-productivity/plugin-api';

let definition: IssueProviderPluginDefinition;

beforeAll(async () => {
  (globalThis as unknown as { PluginAPI: unknown }).PluginAPI = {
    registerIssueProvider: vi.fn((def: IssueProviderPluginDefinition) => {
      definition = def;
    }),
    translate: (key: string) => key,
  };
  await import('./plugin');
});

interface GraphQLBody {
  query: string;
  variables: Record<string, unknown>;
}

interface CapturedHttp {
  http: PluginHttp;
  bodies: GraphQLBody[];
}

interface ReducedNode {
  id: string;
  identifier: string;
  number: number;
  title: string;
  updatedAt: string;
  url: string;
  state: { id: string; name: string; type: string };
}

// Capture the GraphQL variables each call sends. Returning no nodes keeps the
// mapping step trivial.
const makeHttp = (nodes: ReducedNode[] = []): CapturedHttp => {
  const bodies: GraphQLBody[] = [];
  const http = {
    post: vi.fn(async (_url: string, body: GraphQLBody) => {
      bodies.push(body);
      return { data: { viewer: { assignedIssues: { nodes } } } };
    }),
  } as unknown as PluginHttp;
  return { http, bodies };
};

const makeIssue = (n: number): ReducedNode => ({
  id: `uuid-${n}`,
  identifier: `ENG-${n}`,
  number: n,
  title: `Issue ${n}`,
  updatedAt: '2026-01-01T00:00:00.000Z',
  url: `https://linear.app/acme/issue/ENG-${n}`,
  state: { id: 's1', name: 'Todo', type: 'unstarted' },
});

describe('Linear Plugin - auto-import current-cycle scoping', () => {
  it('sends the active-cycle filter for auto-import when enabled', async () => {
    const { http, bodies } = makeHttp();
    const cfg = { isAutoImportCurrentCycleOnly: true };
    await definition.getNewIssuesForBacklog!(cfg, http);
    expect(bodies[0].variables.cycle).toEqual({ isActive: { eq: true } });
  });

  it('omits the cycle filter for auto-import when disabled', async () => {
    const { http, bodies } = makeHttp();
    await definition.getNewIssuesForBacklog!({}, http);
    expect(bodies[0].variables).not.toHaveProperty('cycle');
  });

  // Regression guard: the cycle filter must stay on the auto-import path only,
  // so manual search remains the escape hatch for issues without a cycle.
  it('does not send the cycle filter for manual search even when enabled', async () => {
    const { http, bodies } = makeHttp();
    const cfg = { isAutoImportCurrentCycleOnly: true };
    await definition.searchIssues('ENG-1', cfg, http);
    expect(bodies[0].variables).not.toHaveProperty('cycle');
  });
});

describe('Linear Plugin - generic filters apply to both paths', () => {
  it('applies team and project to manual search', async () => {
    const { http, bodies } = makeHttp();
    const cfg = { teamId: 't1', projectId: 'p1' };
    await definition.searchIssues('', cfg, http);
    expect(bodies[0].variables.team).toEqual({ id: { eq: 't1' } });
    expect(bodies[0].variables.project).toEqual({ id: { eq: 'p1' } });
  });

  it('applies team and project to auto-import', async () => {
    const { http, bodies } = makeHttp();
    const cfg = { teamId: 't1', projectId: 'p1', isAutoImportCurrentCycleOnly: true };
    await definition.getNewIssuesForBacklog!(cfg, http);
    expect(bodies[0].variables.team).toEqual({ id: { eq: 't1' } });
    expect(bodies[0].variables.project).toEqual({ id: { eq: 'p1' } });
    expect(bodies[0].variables.cycle).toEqual({ isActive: { eq: true } });
  });
});

describe('Linear Plugin - manual search term filtering', () => {
  it('filters client-side by identifier and title', async () => {
    const { http } = makeHttp([makeIssue(1), makeIssue(2)]);
    const results = await definition.searchIssues('ENG-2', {}, http);
    expect(results.map((r) => r.id)).toEqual(['uuid-2']);
  });
});
