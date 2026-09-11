# Adding an issue integration

New external issue and calendar integrations should be **issue-provider plugins**.
Do not add a new built-in provider to `src/app/features/issue/providers/` unless a
maintainer has approved a core-only requirement that the plugin API cannot meet.

The public TypeScript definitions are authoritative:

- [`packages/plugin-api/src/issue-provider-types.ts`](../packages/plugin-api/src/issue-provider-types.ts)
- [`packages/plugin-api/src/types.ts`](../packages/plugin-api/src/types.ts)

Use a current bundled provider as the implementation reference:

- [GitHub](../packages/plugin-dev/github-issue-provider/) for search, comments,
  backlog import, and field synchronization
- [Google Calendar](../packages/plugin-dev/google-calendar-provider/) for OAuth,
  agenda fields, and event write-back
- [CalDAV](../packages/plugin-dev/caldav-calendar-provider/) for text responses,
  nonstandard HTTP verbs, and an approved private-network provider

For general plugin packaging, UI, permissions, and security, read
[Plugin development](plugin-development.md).

## 1. Create the plugin package

A repository-owned provider normally lives under
`packages/plugin-dev/<provider-name>/`:

```text
<provider-name>/
├── package.json
├── scripts/build.js
├── src/
│   ├── manifest.json
│   ├── plugin.ts
│   └── icon.svg
└── *.spec.ts
```

Keep provider API types and mapping logic inside the package. Do not add the
provider to core issue-provider unions, defaults, forms, or Angular services.

Minimal manifest:

```json
{
  "id": "example-issue-provider",
  "name": "Example Issues",
  "version": "1.0.0",
  "manifestVersion": 1,
  "minSupVersion": "18.0.0",
  "description": "Connects Example issues to Super Productivity",
  "type": "issueProvider",
  "icon": "icon.svg",
  "iFrame": false,
  "permissions": ["http"],
  "hooks": [],
  "issueProvider": {
    "pollIntervalMs": 600000,
    "icon": "extension",
    "humanReadableName": "Example",
    "issueStrings": {
      "singular": "Issue",
      "plural": "Issues"
    }
  }
}
```

Omit `issueProvider.issueProviderKey` for a new provider. The host assigns
`plugin:<plugin-id>`. That field is reserved for repository-managed plugins that
migrate an existing built-in key and its persisted configurations.

## 2. Register the provider

`IssueProviderPluginDefinition` is Promise-based. Implement the exact current
type rather than copying a method list into the plugin:

```typescript
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@super-productivity/plugin-api';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
};

const API = 'https://api.example.com';

PluginAPI.registerIssueProvider({
  configFields: [
    {
      key: 'workspace',
      type: 'input',
      label: 'Workspace',
      required: true,
    },
  ],

  getHeaders(): Record<string, string> {
    return { Accept: 'application/json' };
  },

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const workspace = String(config.workspace);
    return http.get<PluginSearchResult[]>(`${API}/workspaces/${workspace}/issues`, {
      params: { query: searchTerm },
    });
  },

  async getById(
    issueId: string,
    _config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    return http.get<PluginIssue>(`${API}/issues/${encodeURIComponent(issueId)}`);
  },

  getIssueLink(issueId: string): string {
    return `https://example.com/issues/${encodeURIComponent(issueId)}`;
  },

  issueDisplay: [
    { field: 'title', label: 'Title', type: 'link', linkField: 'url' },
    { field: 'state', label: 'State', type: 'text' },
    { field: 'body', label: 'Description', type: 'markdown', hideEmpty: true },
  ],
});
```

The required contract is `configFields`, `getHeaders`, `searchIssues`, `getById`,
`getIssueLink`, and `issueDisplay`. Optional capabilities include connection
testing, comments, backlog import, field mappings, create/update/delete, and
calendar time-block operations. Add only capabilities the provider actually
supports.

Use the `PluginHttp` argument for provider requests. It returns Promises, applies
the provider headers, and limits methods and timeouts. Its initial-URL check
rejects known metadata hosts, common local hostnames, and literal private IP
addresses by default. It does not resolve hostnames before the request or
revalidate redirect targets, and issue-provider requests currently follow
redirects. Use fixed HTTPS API origins that you trust; do not treat
`PluginHttp` as a complete SSRF boundary. `allowPrivateNetwork` is only honored
for trusted bundled plugins and should be enabled only for a self-hosted
provider that needs it.

`manifest.allowedHosts` scopes the separate `PluginAPI.request` method; it does
not constrain the `PluginHttp` object passed to issue-provider methods. On web
and desktop, `PluginAPI.request` rejects redirects; native requests can still
follow them, and hostname resolution is not revalidated on any platform.

## 3. Handle credentials

### OAuth

Declare both `"oauth"` and `"http"` permissions and add an `oauthButton` field
with an `OAuthFlowConfig`. The host starts the platform-appropriate OAuth flow and
stores the resulting token. Provider methods retrieve it asynchronously:

```typescript
declare const PluginAPI: {
  getOAuthToken(): Promise<string | null>;
};

async function getHeaders(): Promise<Record<string, string>> {
  const token = await PluginAPI.getOAuthToken();
  if (!token) throw new Error('Connect the account first.');
  return { Authorization: `Bearer ${token}` };
}
```

See the Google Calendar provider for desktop, Android, iOS, scope, and PKCE
configuration. A `clientSecret` embedded in plugin source or configuration is not
confidential. Include one only when the provider explicitly treats that client as
public; never commit a confidential OAuth secret.

### API tokens and passwords

Do not store secrets in synced plugin data or provider configuration merely
because a field uses `type: "password"`; that only masks the UI. Plugin-managed
credential setup should use the local, per-plugin secret API:

```typescript
await PluginAPI.setSecret('api-token', token);
const token = await PluginAPI.getSecret('api-token');
await PluginAPI.deleteSecret('api-token');
```

These values are per-device and excluded from Super Productivity sync, exports,
and backups. They are currently unencrypted at rest, so this is an isolation
boundary, not hardware-backed secure storage. Users must enter the secret again
on each device.

Never log tokens, authorization headers, response bodies containing user content,
or issue titles.

## 4. Map data deliberately

- Normalize remote IDs to strings.
- Convert timestamps explicitly and test timezone/all-day behavior.
- Return only the fields needed by `PluginSearchResult` and `PluginIssue`.
- Define `fieldMappings` only for safe, reversible semantics. Default a mapping
  to `off` or `pullOnly` when remote write behavior is surprising.
- Make create/update/delete idempotent where the provider permits it.
- Handle rate limits, pagination, deleted states, and partial API responses.
- Keep provider-specific data inside the plugin instead of extending core models.

## 5. Bundle and document a repository-owned provider

For a bundled provider:

1. Add its build to `packages/plugin-dev/scripts/build-all.js`.
2. Copy the built output into `src/assets/bundled-plugins/<plugin-id>/`.
3. Add the asset path to the bundled list in `src/app/plugins/plugin.service.ts`.
4. Add only English source strings; follow existing plugin i18n packaging.
5. Update the issue-provider comparison in `docs/wiki/` in the same change.

Uploaded community plugins do not need core registration and keep their
`plugin:<plugin-id>` provider key.

## 6. Verify

At minimum:

```bash
cd packages/plugin-dev/<provider-name>
npm run typecheck
npm test
npm run build
```

If the package has no test script yet, add focused tests for response mapping,
authentication failures, pagination, dates, and write-back conversions. Then run
the repository plugin build:

```bash
npm run plugins:build
```

Manually verify configuration, connection testing, search/import, polling, and
any enabled write-back on web, Electron, and each claimed native platform.

## Legacy core providers

Existing built-in providers still implement
[`IssueServiceInterface`](../src/app/features/issue/issue-service-interface.ts),
whose current methods return Promises. Fixes to an existing built-in provider
should follow its established folder and tests.

Adding another core provider creates permanent unions, configuration state,
forms, migrations, and sync compatibility. Do not follow that path for a new
integration without an explicit architecture decision explaining why the plugin
contract is insufficient.
