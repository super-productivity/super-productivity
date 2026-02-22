# Nextcloud Deck Issue Provider Design

**Date**: 2026-02-22
**Issue**: https://github.com/super-productivity/super-productivity/issues/982
**Status**: Draft

## Goal

Add a new "Nextcloud Deck" issue provider that uses the Deck REST API to import cards as tasks, sync completion status back to Deck, and clearly distinguish Deck descriptions from SP notes.

## Key Decisions

- **Separate provider**: New `NEXTCLOUD_DECK` provider type (not an enhancement to CalDAV)
- **REST API**: Uses Deck REST API v1.0+ (`/index.php/apps/deck/api/v1.0/...`), not CalDAV/WebDAV
- **Flat mapping**: Cards become regular SP tasks (not sub-tasks of stacks). Stack names stored as metadata for display.
- **Assignee filtering**: By default, only cards assigned to the configured user are imported. Configurable via `filterByAssignee` toggle.

## Data Models

### DeckCfg (provider configuration)

```typescript
interface DeckCfg extends BaseIssueProviderCfg {
  nextcloudBaseUrl: string | null;     // e.g., https://nextcloud.example.com
  username: string | null;
  password: string | null;              // App password recommended
  selectedBoardId: number | null;       // Which board to sync
  importStackIds: number[] | null;      // Stacks to import cards from (null = all)
  doneStackId: number | null;           // Stack to move completed cards to (optional)
  isTransitionIssuesEnabled: boolean;   // Sync completion back to Deck
  filterByAssignee: boolean;            // Only import cards assigned to username (default: true)
}
```

### DeckIssue (card data)

```typescript
interface DeckIssueReduced {
  id: number;                   // Card ID
  title: string;
  stackId: number;
  stackTitle: string;           // Denormalized for display
  lastModified: number;         // Timestamp for change detection
  done: boolean;
  labels: { id: number; title: string; color: string }[];
}

interface DeckIssue extends DeckIssueReduced {
  description: string;
  duedate: string | null;       // ISO-8601
  assignedUsers: { participant: { uid: string; displayname: string } }[];
  boardId: number;
  order: number;
}
```

## API Client

### Authentication

- Basic auth: `Authorization: Basic base64(user:pass)`
- Required header: `OCS-APIREQUEST: true`
- Base URL: `{nextcloudBaseUrl}/index.php/apps/deck/api/v1.0`

### Key Methods

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `getBoards()` | `GET /boards` | Config UI: board selector |
| `getStacks(boardId)` | `GET /boards/{boardId}/stacks` | Fetch stacks with embedded cards |
| `getCardDetails(boardId, stackId, cardId)` | `GET /boards/.../cards/{cardId}` | Full card details |
| `updateCard(boardId, stackId, cardId, changes)` | `PUT /boards/.../cards/{cardId}` | Mark done, update title |
| `reorderCard(boardId, stackId, cardId, targetStackId, order)` | `PUT /boards/.../cards/{cardId}/reorder` | Move card to done stack |

### Polling

- Interval: 10 minutes (matching CalDAV)
- Uses `If-Modified-Since` header on stacks endpoint for efficiency
- Change detection: compare card `lastModified` timestamp

### Assignee Filtering

- When `filterByAssignee` is `true` (default), filter cards client-side: only include cards where `assignedUsers[].participant.uid` matches the configured `username`
- The Deck API does not support server-side assignee filtering

## Completion Sync

### SP task marked done

1. If `isTransitionIssuesEnabled` is `true`:
   - Set card `done: true` via `PUT .../cards/{cardId}`
   - If `doneStackId` is configured, move card to that stack via reorder endpoint
2. If task un-done:
   - Set card `done: false`
   - Do not move card back (user handles manually in Deck)

### Deck card updated (detected via polling)

- Update SP task `isDone` if card `done` changed
- Update title if changed
- Show notification for other changes (description, labels, etc.)

## Description Labeling

In the issue content panel for Deck-linked tasks:
- Deck card description labeled **"Deck Description"** (translated)
- SP's own notes field remains unchanged (already called "Notes" in UI)

## File Structure

```
src/app/features/issue/providers/nextcloud-deck/
  nextcloud-deck.model.ts                      # DeckCfg, DEFAULT_DECK_CFG
  nextcloud-deck-issue.model.ts                # DeckIssue, DeckIssueReduced
  nextcloud-deck-api.service.ts                # HTTP client for Deck REST API
  nextcloud-deck-common-interfaces.service.ts  # Implements IssueServiceInterface
  nextcloud-deck-issue.effects.ts              # Completion sync effects (uses LOCAL_ACTIONS)
  nextcloud-deck.const.ts                      # NEXTCLOUD_DECK_TYPE, poll interval
  nextcloud-deck-cfg-form.const.ts             # Formly config form fields
  nextcloud-deck-issue-content.const.ts        # Issue content display config
  is-nextcloud-deck-enabled.util.ts            # Validation utility
```

## Existing Files to Modify

| File | Change |
|------|--------|
| `issue.model.ts` | Add `IssueProviderNextcloudDeck` to union types |
| `issue.const.ts` | Add `NEXTCLOUD_DECK_TYPE` to provider lists, icons, humanized names |
| `issue.service.ts` | Register in `ISSUE_SERVICE_MAP` |
| `issue-provider.reducer.ts` | Add default config for new provider |
| `src/assets/i18n/en.json` | Add translation keys under `F.NEXTCLOUD_DECK` |

## Config Form UI

Fields in the configuration form:
1. **Nextcloud URL** (required, URL input)
2. **Username** (required)
3. **Password** (required, password input, hint: "App password recommended")
4. **Board** (required, dropdown populated via `getBoards()` API call)
5. **Advanced** (collapsible):
   - **Only import cards assigned to me** (checkbox, default: checked)
   - **Import from stacks** (multi-select, populated from selected board's stacks, default: all)
   - **Sync completion back to Deck** (checkbox, default: false)
   - **Done stack** (dropdown, visible only when completion sync enabled, populated from stacks)
   - Common issue provider fields (auto-add to backlog, etc.)

## References

- [Nextcloud Deck REST API docs](https://deck.readthedocs.io/en/latest/API/)
- [Deck API source (GitHub)](https://github.com/nextcloud/deck/blob/main/docs/API.md)
- Existing CalDAV provider: `src/app/features/issue/providers/caldav/`
- ClickUp subtask pattern: `src/app/features/issue/providers/clickup/clickup-common-interfaces.service.ts`
- Issue service interface: `src/app/features/issue/issue-service-interface.ts`
