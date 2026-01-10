# Evaluation: Migrating Issue Providers to Plugin System

## Summary

**Goals**: Enable community providers, reduce core bundle size, hybrid UI (app controls standard UI, plugins can extend), full feature parity including Jira worklogs/transitions.

**Verdict**: Feasible but significant effort. The hybrid approach is the right strategy - it preserves native UX while allowing plugin flexibility.

---

## Complexity Assessment

| Aspect                        | Complexity | Notes                                |
| ----------------------------- | ---------- | ------------------------------------ |
| Plugin API extension          | Medium     | ~8 new methods needed                |
| State management              | Low        | Extend existing IssueProvider model  |
| Config UI                     | Medium     | JSON Schema to Formly conversion     |
| Issue content display         | Low        | Plugin provides config, app renders  |
| Add-task bar search           | Medium     | Route searches to plugin providers   |
| Polling infrastructure        | Low        | App already handles timers/batching  |
| Custom actions (worklogs etc) | High       | New UI integration points needed     |
| Bundle size reduction         | Medium     | Requires lazy loading infrastructure |
| Migration (9 providers)       | High       | Each ~1-2 weeks to convert           |

**Overall: Medium-High complexity**

---

## Architecture: Hybrid Plugin Issue Provider

```
┌─────────────────────────────────────────────────────────────┐
│                     APP (Angular Core)                       │
├─────────────────────────────────────────────────────────────┤
│  • IssueProviderRegistry - tracks plugin providers           │
│  • Config UI - renders JSON Schema as native forms           │
│  • Add-task bar - searches plugin providers                  │
│  • Issue content display - renders from plugin config        │
│  • Polling - app-controlled timers, dispatches to plugins    │
│  • NgRx state - stores provider configs (built-in + plugin)  │
│  • Custom action menu - shows plugin-registered actions      │
└────────────────────────┬────────────────────────────────────┘
                         │ PluginAPI.issueProvider.*
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   PLUGIN (JavaScript)                        │
├─────────────────────────────────────────────────────────────┤
│  • Register provider manifest (capabilities, config schema)  │
│  • Handle requests (search, getById, refresh, testConnection)│
│  • Define issue field display configuration                  │
│  • Register custom actions (worklogs, transitions)           │
│  • Open custom dialogs for advanced workflows                │
└─────────────────────────────────────────────────────────────┘
```

---

## New PluginAPI Methods Required

```typescript
// Registration
registerIssueProvider(manifest: IssueProviderManifest): void;

// Request handling (plugin implements this)
onIssueProviderRequest(
  handler: (request: IssueProviderRequest) => Promise<IssueProviderResponse>
): void;

// Custom actions for advanced features
registerIssueAction(action: IssueCustomAction): void;
onIssueAction(actionId: string, handler: (ctx: ActionContext) => Promise<void>): void;

// Custom dialogs (iFrame-based for complex UI like worklogs)
openIssueDialog(config: IssueDialogConfig): Promise<unknown>;

// Config access
getIssueProviderConfig(providerId: string): Promise<Record<string, unknown>>;
```

### IssueProviderManifest Structure

```typescript
interface IssueProviderManifest {
  providerKey: string; // e.g., 'PLUGIN_LINEAR'
  displayName: string;
  icon: string; // SVG or Material icon

  capabilities: {
    search: boolean;
    polling: boolean;
    backlogImport: boolean;
    updateFromTask: boolean; // sync task changes back
  };

  configSchema: JSONSchema7; // App renders as native form
  pollInterval?: number; // ms, 0 = no polling

  issueContentConfig: {
    // How to display issue details
    fields: IssueFieldConfig[];
    comments?: CommentConfig;
  };

  customActions?: IssueCustomAction[]; // Worklogs, transitions, etc.
}
```

---

## How Advanced Features Work

### Example: Jira Worklog

1. **Plugin registers action:**

```javascript
api.registerIssueProvider({
  providerKey: 'PLUGIN_JIRA',
  customActions: [
    {
      id: 'jira-worklog',
      label: 'Log Work',
      icon: 'schedule',
      placement: ['taskMenu', 'issuePanel'],
    },
  ],
  // ...
});
```

2. **User clicks "Log Work" in task menu**

3. **App calls plugin's action handler:**

```javascript
api.onIssueAction('jira-worklog', async (ctx) => {
  // Open iFrame dialog with worklog form
  const result = await api.openIssueDialog({
    title: `Log Work - ${ctx.issue.key}`,
    iframeUrl: 'worklog.html',
    data: { task: ctx.task, issue: ctx.issue },
  });

  if (result?.submitted) {
    // Submit to Jira API, then refresh
    await submitWorklog(result.data);
    api.dispatchAction({ type: '[Task] Refresh Issue', taskId: ctx.task.id });
  }
});
```

4. **Plugin's `worklog.html` renders the form in iFrame**

---

## What App Controls vs What Plugin Controls

| Responsibility        | App                        | Plugin                        |
| --------------------- | -------------------------- | ----------------------------- |
| Config form UI        | JSON Schema -> native form | Provides schema               |
| Issue list/search UI  | Renders search results     | Returns data                  |
| Issue content display | Renders fields             | Provides field config         |
| Polling timing        | Manages timers             | Handles refresh requests      |
| State persistence     | NgRx store + sync          | Provider config stored by app |
| Custom action menu    | Shows action buttons       | Registers actions + handlers  |
| Custom dialogs        | Hosts iFrame               | Provides iFrame content       |

---

## Implementation Phases

### Phase 1: Plugin API Foundation

- Add `registerIssueProvider()` and `onIssueProviderRequest()` to PluginAPI
- Create `PluginIssueProviderRegistry` service
- Create `PluginIssueProviderProxy` implementing `IssueServiceInterface`
- Modify `IssueService` to route to plugin providers
- Extend `IssueProvider` model with `pluginConfig` field

**Files to modify:**

- `src/app/plugins/plugin-api.ts`
- `src/app/plugins/plugin-bridge.service.ts`
- `src/app/features/issue/issue.service.ts`
- `src/app/features/issue/issue.model.ts`

**Files to create:**

- `src/app/plugins/issue-provider/plugin-issue-provider.registry.ts`
- `src/app/plugins/issue-provider/plugin-issue-provider.proxy.ts`
- `packages/plugin-api/src/issue-provider.ts` (types)

### Phase 2: Core Integration

- Add plugin provider search to add-task bar
- Support plugin `issueContentConfig` in issue display component
- Create config dialog that renders JSON Schema
- Integrate plugin providers into polling effects

**Files to modify:**

- `src/app/features/tasks/add-task-bar/add-task-bar-issue-search.service.ts`
- `src/app/features/issue/issue-content/issue-content.component.ts`
- `src/app/features/issue/store/poll-issue-updates.effects.ts`

### Phase 3: Custom Actions

- Add `registerIssueAction()` and `onIssueAction()` to PluginAPI
- Create UI for showing plugin actions in task context menu
- Implement `openIssueDialog()` for iFrame-based custom dialogs

**Files to modify:**

- `src/app/features/tasks/task-context-menu/task-context-menu.component.ts`
- `src/app/features/issue/issue-content/issue-content.component.ts`

**Files to create:**

- `src/app/plugins/ui/plugin-issue-dialog/plugin-issue-dialog.component.ts`

### Phase 4: Sample Plugin + Documentation

- Create sample plugin (e.g., Linear or simple GitHub clone)
- Write plugin development guide
- Test full workflow

### Phase 5: Migrate Built-in Providers (optional, per-provider)

- Convert providers to plugin format
- Add lazy loading for bundle reduction
- Keep built-in as fallback during transition

---

## Advantages

1. **Community providers**: Anyone can create a provider without forking the app
2. **Decoupled releases**: Provider updates independent of app releases
3. **Reduced bundle** (Phase 5): ~1.2MB of provider code can be lazy-loaded
4. **Consistent architecture**: Single plugin system for all extensions
5. **User choice**: Install only providers you need

## Disadvantages

1. **Development effort**: Significant upfront work
2. **Dual maintenance**: During transition, maintain both systems
3. **Plugin dialog UX**: iFrame dialogs won't match app styling perfectly
4. **Type safety**: Plugin code is JavaScript, loses TypeScript benefits
5. **Performance**: Small overhead from plugin communication

---

## Risks & Mitigations

| Risk                             | Mitigation                                   |
| -------------------------------- | -------------------------------------------- |
| Plugin dialogs feel disconnected | Pass theme CSS vars, provide styling guide   |
| Breaking existing configs        | Keep built-in providers, migration tool      |
| Plugin security (credentials)    | Configs stored in app, passed per-request    |
| Performance overhead             | Batch requests, cache in registry            |
| Complex provider migration       | Start with simple providers (Gitea, Redmine) |

---

## Effort Estimate

| Phase   | Scope                  | Effort         |
| ------- | ---------------------- | -------------- |
| Phase 1 | Plugin API foundation  | 1-2 weeks      |
| Phase 2 | Core integration       | 1-2 weeks      |
| Phase 3 | Custom actions         | 1 week         |
| Phase 4 | Sample plugin + docs   | 1 week         |
| Phase 5 | Per-provider migration | 1-2 weeks each |

**Total for enabling plugin providers**: ~4-6 weeks
**Per built-in provider migration**: ~1-2 weeks each (9 providers = 9-18 weeks if all migrated)

---

## Recommendation

**Start with Phases 1-4** to enable community providers. This gives you:

- Community can create new providers
- Proves the architecture works
- ~4-6 weeks of work

**Phase 5 (migration)** can be done incrementally or skipped:

- Built-in providers continue working
- Migrate only if bundle size becomes critical
- Start with simple providers (Gitea, Redmine)
- Keep Jira built-in longest (most complex)

This approach gets value quickly while keeping risk low.
