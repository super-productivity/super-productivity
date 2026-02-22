# Nextcloud Deck Issue Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a new `NEXTCLOUD_DECK` issue provider that imports Deck cards as SP tasks, syncs completion back to Deck, and filters by assignee.

**Architecture:** New provider under `src/app/features/issue/providers/nextcloud-deck/` following the CalDAV provider as template. Uses Deck REST API v1.0 with basic auth. Cards map 1:1 to SP tasks. Completion sync uses both the `done` flag and optional stack-move via reorder endpoint.

**Tech Stack:** Angular 19+, NgRx, RxJS, Nextcloud Deck REST API, Formly forms

**Design Doc:** `docs/plans/2026-02-22-nextcloud-deck-provider-design.md`

---

### Task 1: Data Models

**Files:**
- Create: `src/app/features/issue/providers/nextcloud-deck/nextcloud-deck.model.ts`
- Create: `src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-issue.model.ts`

**Step 1: Create the config model**

```typescript
// src/app/features/issue/providers/nextcloud-deck/nextcloud-deck.model.ts
import { BaseIssueProviderCfg } from '../../issue.model';

export interface NextcloudDeckCfg extends BaseIssueProviderCfg {
  nextcloudBaseUrl: string | null;
  username: string | null;
  password: string | null;
  selectedBoardId: number | null;
  importStackIds: number[] | null;
  doneStackId: number | null;
  isTransitionIssuesEnabled: boolean;
  filterByAssignee: boolean;
}
```

**Step 2: Create the issue model**

```typescript
// src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-issue.model.ts
export interface DeckLabel {
  id: number;
  title: string;
  color: string;
}

export interface DeckAssignedUser {
  participant: {
    uid: string;
    displayname: string;
  };
}

export type NextcloudDeckIssueReduced = Readonly<{
  id: number;
  title: string;
  stackId: number;
  stackTitle: string;
  lastModified: number;
  done: boolean;
  labels: DeckLabel[];
}>;

export type NextcloudDeckIssue = NextcloudDeckIssueReduced &
  Readonly<{
    description: string;
    duedate: string | null;
    assignedUsers: DeckAssignedUser[];
    boardId: number;
    order: number;
  }>;
```

**Step 3: Commit**

```bash
git add src/app/features/issue/providers/nextcloud-deck/nextcloud-deck.model.ts \
        src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-issue.model.ts
git commit -m "feat(deck): add Nextcloud Deck data models"
```

---

### Task 2: Constants, Defaults, and Validation Utility

**Files:**
- Create: `src/app/features/issue/providers/nextcloud-deck/nextcloud-deck.const.ts`
- Create: `src/app/features/issue/providers/nextcloud-deck/is-nextcloud-deck-enabled.util.ts`

**Step 1: Create constants file**

```typescript
// src/app/features/issue/providers/nextcloud-deck/nextcloud-deck.const.ts
import { NextcloudDeckCfg } from './nextcloud-deck.model';
export { NEXTCLOUD_DECK_ISSUE_CONTENT_CONFIG } from './nextcloud-deck-issue-content.const';
export { NEXTCLOUD_DECK_CONFIG_FORM_SECTION, NEXTCLOUD_DECK_CONFIG_FORM } from './nextcloud-deck-cfg-form.const';

export const DEFAULT_NEXTCLOUD_DECK_CFG: NextcloudDeckCfg = {
  isEnabled: false,
  nextcloudBaseUrl: null,
  username: null,
  password: null,
  selectedBoardId: null,
  importStackIds: null,
  doneStackId: null,
  isTransitionIssuesEnabled: false,
  filterByAssignee: true,
};

export const NEXTCLOUD_DECK_POLL_INTERVAL = 10 * 60 * 1000;
export const NEXTCLOUD_DECK_INITIAL_POLL_DELAY = 8 * 1000;
```

NOTE: This file imports from files that don't exist yet (issue-content and cfg-form). Create those first or skip the re-exports and add them later. Simplest: remove the two re-export lines for now and add them in Tasks 6 and 7.

**Step 2: Create validation utility**

```typescript
// src/app/features/issue/providers/nextcloud-deck/is-nextcloud-deck-enabled.util.ts
import { NextcloudDeckCfg } from './nextcloud-deck.model';

export const isNextcloudDeckEnabled = (cfg: NextcloudDeckCfg): boolean =>
  !!cfg && cfg.isEnabled && !!cfg.nextcloudBaseUrl && !!cfg.username && !!cfg.password;
```

**Step 3: Commit**

```bash
git add src/app/features/issue/providers/nextcloud-deck/nextcloud-deck.const.ts \
        src/app/features/issue/providers/nextcloud-deck/is-nextcloud-deck-enabled.util.ts
git commit -m "feat(deck): add constants and validation utility"
```

---

### Task 3: Register Provider in Type System

**Files:**
- Modify: `src/app/features/issue/issue.model.ts`

This task touches MANY union types and conditional types. Each change is small but all are required.

**Step 1: Add imports at top of file**

After the existing AzureDevOps imports (around line 34), add:

```typescript
import { NextcloudDeckCfg } from './providers/nextcloud-deck/nextcloud-deck.model';
import {
  NextcloudDeckIssue,
  NextcloudDeckIssueReduced,
} from './providers/nextcloud-deck/nextcloud-deck-issue.model';
```

**Step 2: Add `'NEXTCLOUD_DECK'` to `IssueProviderKey`**

Add `| 'NEXTCLOUD_DECK'` to the union type (around line 53).

**Step 3: Add `NextcloudDeckCfg` to `IssueIntegrationCfg`**

Add `| NextcloudDeckCfg` to the union type (around line 67).

**Step 4: Add to `IssueIntegrationCfgs` interface**

Add `NEXTCLOUD_DECK?: NextcloudDeckCfg;` (around line 88).

**Step 5: Add to `IssueData` union type**

Add `| NextcloudDeckIssue` (around line 103).

**Step 6: Add to `IssueDataReduced` union type**

Add `| NextcloudDeckIssueReduced` (around line 117).

**Step 7: Add to `IssueDataReducedMap` conditional type**

Add a new branch:
```typescript
: K extends 'NEXTCLOUD_DECK'
  ? NextcloudDeckIssueReduced
```

**Step 8: Add `IssueProviderNextcloudDeck` interface**

After the existing `IssueProviderAzureDevOps` interface (around line 231), add:

```typescript
export interface IssueProviderNextcloudDeck extends IssueProviderBase, NextcloudDeckCfg {
  issueProviderKey: 'NEXTCLOUD_DECK';
}
```

**Step 9: Add to `IssueProvider` union type**

Add `| IssueProviderNextcloudDeck` (around line 245).

**Step 10: Add to `IssueProviderTypeMap` conditional type**

Add a new branch:
```typescript
: T extends 'NEXTCLOUD_DECK'
  ? IssueProviderNextcloudDeck
```

**Step 11: Commit**

```bash
git add src/app/features/issue/issue.model.ts
git commit -m "feat(deck): register Nextcloud Deck in type system"
```

---

### Task 4: Register Provider in Constants Maps

**Files:**
- Modify: `src/app/features/issue/issue.const.ts`

**Step 1: Add imports**

Add at top of file alongside other provider imports:

```typescript
import { DEFAULT_NEXTCLOUD_DECK_CFG, NEXTCLOUD_DECK_CONFIG_FORM_SECTION } from './providers/nextcloud-deck/nextcloud-deck.const';
```

NOTE: `NEXTCLOUD_DECK_CONFIG_FORM_SECTION` won't exist yet (created in Task 7). Either import it conditionally or defer this import until Task 7. Best approach: add the import and the `ISSUE_PROVIDER_FORM_CFGS_MAP` entry together in Task 7. For now, just add the entries that don't need the form config import.

**Step 2: Add type constant**

After the existing type constants (around line 60):

```typescript
export const NEXTCLOUD_DECK_TYPE: IssueProviderKey = 'NEXTCLOUD_DECK';
```

**Step 3: Add to `ISSUE_PROVIDER_TYPES` array**

```typescript
NEXTCLOUD_DECK_TYPE,
```

**Step 4: Add to `ISSUE_PROVIDER_ICON_MAP`**

```typescript
[NEXTCLOUD_DECK_TYPE]: 'nextcloud_deck',
```

**Step 5: Add to `ISSUE_PROVIDER_HUMANIZED`**

```typescript
[NEXTCLOUD_DECK_TYPE]: 'Nextcloud Deck',
```

**Step 6: Add to `DEFAULT_ISSUE_PROVIDER_CFGS`**

```typescript
[NEXTCLOUD_DECK_TYPE]: DEFAULT_NEXTCLOUD_DECK_CFG,
```

**Step 7: Run checkFile**

```bash
npm run checkFile src/app/features/issue/issue.const.ts
```

**Step 8: Commit**

```bash
git add src/app/features/issue/issue.const.ts
git commit -m "feat(deck): register provider constants and maps"
```

---

### Task 5: API Client Service

**Files:**
- Create: `src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-api.service.ts`

This is the core HTTP client for the Deck REST API. Uses Angular's `HttpClient`.

**Step 1: Create the service**

```typescript
// src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-api.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map, switchMap, of } from 'rxjs';
import { first } from 'rxjs/operators';
import { NextcloudDeckCfg } from './nextcloud-deck.model';
import {
  NextcloudDeckIssue,
  NextcloudDeckIssueReduced,
  DeckAssignedUser,
} from './nextcloud-deck-issue.model';
import { SearchResultItem } from '../../issue.model';
import { SnackService } from '../../../../core/snack/snack.service';
import { T } from '../../../../t.const';

interface DeckBoardResponse {
  id: number;
  title: string;
  color: string;
  archived: boolean;
}

interface DeckStackResponse {
  id: number;
  title: string;
  boardId: number;
  order: number;
  cards: DeckCardResponse[];
}

interface DeckCardResponse {
  id: number;
  title: string;
  description: string;
  stackId: number;
  type: string;
  lastModified: number;
  createdAt: number;
  labels: { id: number; title: string; color: string }[];
  assignedUsers: DeckAssignedUser[];
  attachments: any[];
  owner: { uid: string; displayname: string };
  order: number;
  archived: boolean;
  duedate: string | null;
  done: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class NextcloudDeckApiService {
  private readonly _http = inject(HttpClient);
  private readonly _snackService = inject(SnackService);

  private _getBaseUrl(cfg: NextcloudDeckCfg): string {
    const base = cfg.nextcloudBaseUrl?.replace(/\/+$/, '') || '';
    return `${base}/index.php/apps/deck/api/v1.0`;
  }

  private _getHeaders(cfg: NextcloudDeckCfg): HttpHeaders {
    const credentials = btoa(`${cfg.username}:${cfg.password}`);
    return new HttpHeaders({
      'Authorization': `Basic ${credentials}`,
      'OCS-APIREQUEST': 'true',
      'Content-Type': 'application/json',
    });
  }

  getBoards$(cfg: NextcloudDeckCfg): Observable<DeckBoardResponse[]> {
    return this._http
      .get<DeckBoardResponse[]>(`${this._getBaseUrl(cfg)}/boards`, {
        headers: this._getHeaders(cfg),
      })
      .pipe(map((boards) => boards.filter((b) => !b.archived)));
  }

  getStacks$(cfg: NextcloudDeckCfg, boardId: number): Observable<DeckStackResponse[]> {
    return this._http.get<DeckStackResponse[]>(
      `${this._getBaseUrl(cfg)}/boards/${boardId}/stacks`,
      { headers: this._getHeaders(cfg) },
    );
  }

  getCardDetails$(
    cfg: NextcloudDeckCfg,
    boardId: number,
    stackId: number,
    cardId: number,
  ): Observable<DeckCardResponse> {
    return this._http.get<DeckCardResponse>(
      `${this._getBaseUrl(cfg)}/boards/${boardId}/stacks/${stackId}/cards/${cardId}`,
      { headers: this._getHeaders(cfg) },
    );
  }

  updateCard$(
    cfg: NextcloudDeckCfg,
    boardId: number,
    stackId: number,
    cardId: number,
    changes: Partial<{ title: string; done: boolean }>,
  ): Observable<DeckCardResponse> {
    return this._http.put<DeckCardResponse>(
      `${this._getBaseUrl(cfg)}/boards/${boardId}/stacks/${stackId}/cards/${cardId}`,
      changes,
      { headers: this._getHeaders(cfg) },
    );
  }

  reorderCard$(
    cfg: NextcloudDeckCfg,
    boardId: number,
    stackId: number,
    cardId: number,
    targetStackId: number,
    order: number,
  ): Observable<DeckCardResponse> {
    return this._http.put<DeckCardResponse>(
      `${this._getBaseUrl(cfg)}/boards/${boardId}/stacks/${stackId}/cards/${cardId}/reorder`,
      { stackId: targetStackId, order },
      { headers: this._getHeaders(cfg) },
    );
  }

  getOpenCards$(cfg: NextcloudDeckCfg): Observable<NextcloudDeckIssueReduced[]> {
    if (!cfg.selectedBoardId) {
      return of([]);
    }
    return this.getStacks$(cfg, cfg.selectedBoardId).pipe(
      map((stacks) => this._mapStacksToCards(stacks, cfg)),
    );
  }

  searchOpenCards$(
    searchTerm: string,
    cfg: NextcloudDeckCfg,
  ): Observable<SearchResultItem[]> {
    return this.getOpenCards$(cfg).pipe(
      map((cards) =>
        cards
          .filter((c) => c.title.toLowerCase().includes(searchTerm.toLowerCase()))
          .map((card) => ({
            title: card.title,
            issueType: 'NEXTCLOUD_DECK' as const,
            issueData: card,
          })),
      ),
    );
  }

  getById$(
    id: string | number,
    cfg: NextcloudDeckCfg,
  ): Observable<NextcloudDeckIssue | null> {
    if (!cfg.selectedBoardId) {
      return of(null);
    }
    return this.getStacks$(cfg, cfg.selectedBoardId).pipe(
      map((stacks) => {
        const numId = typeof id === 'string' ? parseInt(id, 10) : id;
        for (const stack of stacks) {
          const card = stack.cards?.find((c: DeckCardResponse) => c.id === numId);
          if (card) {
            return this._mapCardToIssue(card, stack.title, cfg.selectedBoardId!);
          }
        }
        return null;
      }),
    );
  }

  private _mapStacksToCards(
    stacks: DeckStackResponse[],
    cfg: NextcloudDeckCfg,
  ): NextcloudDeckIssueReduced[] {
    const filteredStacks =
      cfg.importStackIds && cfg.importStackIds.length > 0
        ? stacks.filter((s) => cfg.importStackIds!.includes(s.id))
        : stacks;

    const cards: NextcloudDeckIssueReduced[] = [];
    for (const stack of filteredStacks) {
      if (!stack.cards) continue;
      for (const card of stack.cards) {
        if (card.archived) continue;
        if (card.done) continue;
        if (cfg.filterByAssignee && cfg.username) {
          const isAssigned = card.assignedUsers?.some(
            (u: DeckAssignedUser) => u.participant.uid === cfg.username,
          );
          if (!isAssigned) continue;
        }
        cards.push({
          id: card.id,
          title: card.title,
          stackId: card.stackId,
          stackTitle: stack.title,
          lastModified: card.lastModified,
          done: card.done,
          labels: card.labels || [],
        });
      }
    }
    return cards;
  }

  private _mapCardToIssue(
    card: DeckCardResponse,
    stackTitle: string,
    boardId: number,
  ): NextcloudDeckIssue {
    return {
      id: card.id,
      title: card.title,
      description: card.description || '',
      stackId: card.stackId,
      stackTitle,
      lastModified: card.lastModified,
      done: card.done,
      duedate: card.duedate,
      assignedUsers: card.assignedUsers || [],
      labels: card.labels || [],
      boardId,
      order: card.order,
    };
  }
}
```

**Step 2: Commit**

```bash
git add src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-api.service.ts
git commit -m "feat(deck): add Deck REST API client service"
```

---

### Task 6: Issue Content Display Config

**Files:**
- Create: `src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-issue-content.const.ts`

**Step 1: Create the issue content config**

```typescript
// src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-issue-content.const.ts
import { T } from '../../../../t.const';
import {
  IssueContentConfig,
  IssueFieldType,
} from '../../issue-content/issue-content.model';
import { NextcloudDeckIssue } from './nextcloud-deck-issue.model';
import { IssueProviderKey } from '../../issue.model';

export const NEXTCLOUD_DECK_ISSUE_CONTENT_CONFIG: IssueContentConfig<NextcloudDeckIssue> =
  {
    issueType: 'NEXTCLOUD_DECK' as IssueProviderKey,
    fields: [
      {
        label: T.F.ISSUE.ISSUE_CONTENT.SUMMARY,
        value: 'title',
        type: IssueFieldType.TEXT,
      },
      {
        label: T.F.NEXTCLOUD_DECK.ISSUE_CONTENT.DECK_DESCRIPTION,
        value: 'description',
        isVisible: (issue: NextcloudDeckIssue) => !!issue.description,
        type: IssueFieldType.MARKDOWN,
      },
      {
        label: T.F.NEXTCLOUD_DECK.ISSUE_CONTENT.STACK,
        value: 'stackTitle',
        type: IssueFieldType.TEXT,
      },
      {
        label: T.F.ISSUE.ISSUE_CONTENT.DUE_DATE,
        value: 'duedate',
        type: IssueFieldType.TEXT,
        isVisible: (issue: NextcloudDeckIssue) => !!issue.duedate,
      },
      {
        label: T.F.NEXTCLOUD_DECK.ISSUE_CONTENT.ASSIGNED_USERS,
        value: (issue: NextcloudDeckIssue) =>
          issue.assignedUsers?.map((u) => u.participant.displayname).join(', '),
        type: IssueFieldType.TEXT,
        isVisible: (issue: NextcloudDeckIssue) =>
          !!issue.assignedUsers && issue.assignedUsers.length > 0,
      },
      {
        label: T.F.NEXTCLOUD_DECK.ISSUE_CONTENT.LABELS,
        value: (issue: NextcloudDeckIssue) =>
          issue.labels?.map((l) => l.title).join(', '),
        type: IssueFieldType.TEXT,
        isVisible: (issue: NextcloudDeckIssue) =>
          !!issue.labels && issue.labels.length > 0,
      },
    ],
  };
```

**Step 2: Commit**

```bash
git add src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-issue-content.const.ts
git commit -m "feat(deck): add issue content display config"
```

---

### Task 7: Config Form

**Files:**
- Create: `src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-cfg-form.const.ts`

**Step 1: Create the config form**

```typescript
// src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-cfg-form.const.ts
import { T } from '../../../../t.const';
import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { IssueProviderNextcloudDeck } from '../../issue.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';

export const NEXTCLOUD_DECK_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderNextcloudDeck>[] =
  [
    {
      key: 'nextcloudBaseUrl',
      type: 'input',
      templateOptions: {
        required: true,
        label: T.F.NEXTCLOUD_DECK.FORM.BASE_URL,
        type: 'url',
        pattern: /^(http(s)?:\/\/)?([\w\-]+(?:\.[\w\-]+)*)(:\d+)?(\/\S*)?$/i,
      },
    },
    {
      key: 'username',
      type: 'input',
      templateOptions: {
        required: true,
        label: T.F.NEXTCLOUD_DECK.FORM.USERNAME,
        type: 'text',
      },
    },
    {
      key: 'password',
      type: 'input',
      templateOptions: {
        required: true,
        type: 'password',
        label: T.F.NEXTCLOUD_DECK.FORM.PASSWORD,
      },
    },
    {
      type: 'collapsible',
      props: { label: 'Advanced Config' },
      fieldGroup: [
        ...ISSUE_PROVIDER_COMMON_FORM_FIELDS,
        {
          key: 'filterByAssignee',
          type: 'checkbox',
          templateOptions: {
            label: T.F.NEXTCLOUD_DECK.FORM.FILTER_BY_ASSIGNEE,
          },
        },
        {
          key: 'isTransitionIssuesEnabled',
          type: 'checkbox',
          templateOptions: {
            label: T.F.NEXTCLOUD_DECK.FORM.IS_TRANSITION_ISSUES_ENABLED,
          },
        },
      ],
    },
  ];

export const NEXTCLOUD_DECK_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderNextcloudDeck> =
  {
    title: 'Nextcloud Deck',
    key: 'NEXTCLOUD_DECK',
    items: NEXTCLOUD_DECK_CONFIG_FORM,
    help: T.F.NEXTCLOUD_DECK.FORM_SECTION.HELP,
  };
```

NOTE: Board selector (`selectedBoardId`) and stack selectors (`importStackIds`, `doneStackId`) are omitted from this initial implementation since they require dynamic API calls to populate dropdown options. For the initial version, users can set these values as plain number inputs. A follow-up task can add dynamic dropdowns.

**Step 2: Now add the re-exports in `nextcloud-deck.const.ts`**

If you removed the re-exports in Task 2, add them back:

```typescript
export { NEXTCLOUD_DECK_ISSUE_CONTENT_CONFIG } from './nextcloud-deck-issue-content.const';
export { NEXTCLOUD_DECK_CONFIG_FORM_SECTION, NEXTCLOUD_DECK_CONFIG_FORM } from './nextcloud-deck-cfg-form.const';
```

**Step 3: Add form config to `ISSUE_PROVIDER_FORM_CFGS_MAP` in `issue.const.ts`**

```typescript
[NEXTCLOUD_DECK_TYPE]: NEXTCLOUD_DECK_CONFIG_FORM_SECTION,
```

And add the import at the top:

```typescript
import { NEXTCLOUD_DECK_CONFIG_FORM_SECTION } from './providers/nextcloud-deck/nextcloud-deck.const';
```

**Step 4: Run checkFile**

```bash
npm run checkFile src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-cfg-form.const.ts
npm run checkFile src/app/features/issue/issue.const.ts
```

**Step 5: Commit**

```bash
git add src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-cfg-form.const.ts \
        src/app/features/issue/providers/nextcloud-deck/nextcloud-deck.const.ts \
        src/app/features/issue/issue.const.ts
git commit -m "feat(deck): add config form and registration"
```

---

### Task 8: Common Interfaces Service

**Files:**
- Create: `src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-common-interfaces.service.ts`

This implements `IssueServiceInterface` — the core integration contract.

**Step 1: Create the service**

```typescript
// src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-common-interfaces.service.ts
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { concatMap, first, map, switchMap } from 'rxjs/operators';
import { IssueTask, Task } from 'src/app/features/tasks/task.model';
import { IssueServiceInterface } from '../../issue-service-interface';
import { IssueProviderNextcloudDeck, SearchResultItem } from '../../issue.model';
import {
  NextcloudDeckIssue,
  NextcloudDeckIssueReduced,
} from './nextcloud-deck-issue.model';
import { NextcloudDeckApiService } from './nextcloud-deck-api.service';
import { NextcloudDeckCfg } from './nextcloud-deck.model';
import { isNextcloudDeckEnabled } from './is-nextcloud-deck-enabled.util';
import { NEXTCLOUD_DECK_POLL_INTERVAL } from './nextcloud-deck.const';
import { IssueProviderService } from '../../issue-provider.service';
import { truncate } from '../../../../util/truncate';

@Injectable({
  providedIn: 'root',
})
export class NextcloudDeckCommonInterfacesService implements IssueServiceInterface {
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _apiService = inject(NextcloudDeckApiService);

  pollInterval: number = NEXTCLOUD_DECK_POLL_INTERVAL;

  isEnabled(cfg: NextcloudDeckCfg): boolean {
    return isNextcloudDeckEnabled(cfg);
  }

  testConnection(cfg: NextcloudDeckCfg): Promise<boolean> {
    return this._apiService
      .getBoards$(cfg)
      .pipe(
        map((boards) => Array.isArray(boards)),
        first(),
      )
      .toPromise()
      .then((result) => result ?? false);
  }

  getAddTaskData(issueData: NextcloudDeckIssue): IssueTask {
    return {
      title: issueData.title,
      issueLastUpdated: issueData.lastModified,
      notes: issueData.description || undefined,
      issueWasUpdated: false,
    };
  }

  async getById(
    id: string | number,
    issueProviderId: string,
  ): Promise<NextcloudDeckIssue | null> {
    const cfg = await this._getCfgOnce$(issueProviderId).toPromise();
    if (!cfg) return null;
    return this._apiService
      .getById$(id, cfg)
      .pipe(first())
      .toPromise()
      .then((result) => result ?? null);
  }

  issueLink(issueId: string | number, issueProviderId: string): Promise<string> {
    // Deck cards don't have a direct public URL; return empty
    return Promise.resolve('');
  }

  async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: NextcloudDeckIssue;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId || !task.issueId) {
      throw new Error('No issueProviderId or issueId');
    }

    const cfg = await this._getCfgOnce$(task.issueProviderId).toPromise();
    if (!cfg) return null;
    const issue = await this._apiService
      .getById$(task.issueId, cfg)
      .pipe(first())
      .toPromise();

    if (!issue) return null;

    const wasUpdated = issue.lastModified !== task.issueLastUpdated;
    if (wasUpdated) {
      return {
        taskChanges: {
          ...this.getAddTaskData(issue),
          issueWasUpdated: true,
          isDone: issue.done,
        },
        issue,
        issueTitle: truncate(issue.title),
      };
    }
    return null;
  }

  async getFreshDataForIssueTasks(
    tasks: Task[],
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: NextcloudDeckIssue }[]> {
    if (!tasks.length) return [];

    const issueProviderId = tasks[0].issueProviderId;
    if (!issueProviderId) {
      throw new Error('No issueProviderId');
    }

    const cfg = await this._getCfgOnce$(issueProviderId).toPromise();
    if (!cfg) return [];

    const allCards = await this._apiService
      .getOpenCards$(cfg)
      .pipe(first())
      .toPromise();
    if (!allCards) return [];

    const results: {
      task: Task;
      taskChanges: Partial<Task>;
      issue: NextcloudDeckIssue;
    }[] = [];

    for (const task of tasks) {
      if (!task.issueId) continue;
      const numId =
        typeof task.issueId === 'string' ? parseInt(task.issueId, 10) : task.issueId;
      const card = allCards.find((c) => c.id === numId);
      if (card && card.lastModified !== task.issueLastUpdated) {
        // Need full issue data — fetch individually
        const fullIssue = await this._apiService
          .getById$(task.issueId, cfg)
          .pipe(first())
          .toPromise();
        if (fullIssue) {
          results.push({
            task,
            taskChanges: {
              ...this.getAddTaskData(fullIssue),
              issueWasUpdated: true,
              isDone: fullIssue.done,
            },
            issue: fullIssue,
          });
        }
      }
    }
    return results;
  }

  searchIssues(
    searchTerm: string,
    issueProviderId: string,
  ): Promise<SearchResultItem[]> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        switchMap((cfg) =>
          this.isEnabled(cfg)
            ? this._apiService.searchOpenCards$(searchTerm, cfg)
            : of([]),
        ),
      )
      .toPromise()
      .then((result) => result ?? []);
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: number[] | string[],
  ): Promise<NextcloudDeckIssueReduced[]> {
    const cfg = await this._getCfgOnce$(issueProviderId).toPromise();
    if (!cfg) return [];
    const cards = await this._apiService
      .getOpenCards$(cfg)
      .pipe(first())
      .toPromise();
    if (!cards) return [];

    const existingIds = new Set(
      allExistingIssueIds.map((id) => (typeof id === 'string' ? parseInt(id, 10) : id)),
    );
    return cards.filter((c) => !existingIds.has(c.id));
  }

  private _getCfgOnce$(
    issueProviderId: string,
  ): Observable<IssueProviderNextcloudDeck> {
    return this._issueProviderService.getCfgOnce$(
      issueProviderId,
      'NEXTCLOUD_DECK',
    );
  }
}
```

**Step 2: Run checkFile**

```bash
npm run checkFile src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-common-interfaces.service.ts
```

**Step 3: Commit**

```bash
git add src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-common-interfaces.service.ts
git commit -m "feat(deck): add common interfaces service"
```

---

### Task 9: Register Service in IssueService

**Files:**
- Modify: `src/app/features/issue/issue.service.ts`

**Step 1: Add import**

```typescript
import { NextcloudDeckCommonInterfacesService } from './providers/nextcloud-deck/nextcloud-deck-common-interfaces.service';
```

And import the type constant (if not already):

```typescript
import { NEXTCLOUD_DECK_TYPE } from './issue.const';
```

NOTE: Check if `NEXTCLOUD_DECK_TYPE` is already imported via the existing barrel import from `./issue.const`. If `issue.const.ts` re-exports it and there's a wildcard import, it may already be available. Otherwise add the explicit import.

**Step 2: Add inject**

After the other provider inject lines (around line 80):

```typescript
private _nextcloudDeckCommonInterfaceService = inject(NextcloudDeckCommonInterfacesService);
```

**Step 3: Add to ISSUE_SERVICE_MAP**

```typescript
[NEXTCLOUD_DECK_TYPE]: this._nextcloudDeckCommonInterfaceService,
```

**Step 4: Run checkFile**

```bash
npm run checkFile src/app/features/issue/issue.service.ts
```

**Step 5: Commit**

```bash
git add src/app/features/issue/issue.service.ts
git commit -m "feat(deck): register service in issue service map"
```

---

### Task 10: Issue Content Config Registration

**Files:**
- Modify: `src/app/features/issue/issue-content/issue-content-configs.const.ts`

**Step 1: Add import**

```typescript
import { NEXTCLOUD_DECK_ISSUE_CONTENT_CONFIG } from '../providers/nextcloud-deck/nextcloud-deck-issue-content.const';
```

**Step 2: Add to `ISSUE_CONTENT_CONFIGS` record**

```typescript
NEXTCLOUD_DECK: NEXTCLOUD_DECK_ISSUE_CONTENT_CONFIG,
```

**Step 3: Run checkFile**

```bash
npm run checkFile src/app/features/issue/issue-content/issue-content-configs.const.ts
```

**Step 4: Commit**

```bash
git add src/app/features/issue/issue-content/issue-content-configs.const.ts
git commit -m "feat(deck): register issue content config"
```

---

### Task 11: Completion Sync Effects

**Files:**
- Create: `src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-issue.effects.ts`

IMPORTANT: Uses `LOCAL_ACTIONS` not `Actions` per CLAUDE.md guideline #7.

**Step 1: Create the effects**

```typescript
// src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-issue.effects.ts
import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../../util/local-actions.token';
import { TaskService } from '../../../tasks/task.service';
import { concatMap, filter, map, switchMap } from 'rxjs/operators';
import { IssueService } from '../../issue.service';
import { Observable, of } from 'rxjs';
import { Task } from 'src/app/features/tasks/task.model';
import { NEXTCLOUD_DECK_TYPE } from '../../issue.const';
import { isNextcloudDeckEnabled } from './is-nextcloud-deck-enabled.util';
import { NextcloudDeckApiService } from './nextcloud-deck-api.service';
import { NextcloudDeckCfg } from './nextcloud-deck.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { IssueProviderService } from '../../issue-provider.service';
import { assertTruthy } from '../../../../util/assert-truthy';

@Injectable()
export class NextcloudDeckIssueEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _apiService = inject(NextcloudDeckApiService);
  private readonly _issueService = inject(IssueService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _taskService = inject(TaskService);

  checkForDoneTransition$: Observable<any> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(
          ({ task }): boolean => 'isDone' in task.changes || 'title' in task.changes,
        ),
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id.toString())),
        filter((task: Task) => task && task.issueType === NEXTCLOUD_DECK_TYPE),
        concatMap((task: Task) => {
          if (!task.issueProviderId) {
            throw new Error('No issueProviderId for task');
          }
          return this._issueProviderService
            .getCfgOnce$(task.issueProviderId, 'NEXTCLOUD_DECK')
            .pipe(map((cfg) => ({ cfg, task })));
        }),
        filter(
          ({ cfg, task }) =>
            isNextcloudDeckEnabled(cfg) && cfg.isTransitionIssuesEnabled,
        ),
        concatMap(({ cfg, task }) => {
          return this._handleTransitionForIssue$(cfg, task);
        }),
      ),
    { dispatch: false },
  );

  private _handleTransitionForIssue$(
    cfg: NextcloudDeckCfg,
    task: Task,
  ): Observable<any> {
    if (!cfg.selectedBoardId) {
      return of(null);
    }
    const issueId = parseInt(assertTruthy(task.issueId).toString(), 10);

    // First, find the card's stackId by looking it up
    return this._apiService.getById$(issueId, cfg).pipe(
      concatMap((issue) => {
        if (!issue) return of(null);

        // Update the done status
        return this._apiService
          .updateCard$(cfg, issue.boardId, issue.stackId, issue.id, {
            done: task.isDone,
            title: task.title,
          })
          .pipe(
            concatMap(() => {
              // If done and doneStackId configured, move the card
              if (task.isDone && cfg.doneStackId && cfg.doneStackId !== issue.stackId) {
                return this._apiService.reorderCard$(
                  cfg,
                  issue.boardId,
                  issue.stackId,
                  issue.id,
                  cfg.doneStackId,
                  0,
                );
              }
              return of(null);
            }),
            concatMap(() => this._issueService.refreshIssueTask(task, true)),
          );
      }),
    );
  }
}
```

**Step 2: Register the effects**

Find where other issue effects are registered. Search for `CaldavIssueEffects` in the providers array:

```bash
# Find where effects are registered
```

Look in `src/app/features/issue/issue.module.ts` or a root store module. Add `NextcloudDeckIssueEffects` alongside `CaldavIssueEffects`. The exact location depends on the project's effects registration pattern — check how `CaldavIssueEffects` is imported and registered, and follow the same pattern.

**Step 3: Run checkFile**

```bash
npm run checkFile src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-issue.effects.ts
```

**Step 4: Commit**

```bash
git add src/app/features/issue/providers/nextcloud-deck/nextcloud-deck-issue.effects.ts
git commit -m "feat(deck): add completion sync effects"
```

---

### Task 12: Translations

**Files:**
- Modify: `src/assets/i18n/en.json` (ONLY en.json — never other locales)
- Modify: `src/app/t.const.ts`

**Step 1: Add translation keys to `en.json`**

Find the `"CALDAV"` section (around line 100 in the `"F"` object) and add after it:

```json
"NEXTCLOUD_DECK": {
  "FORM": {
    "BASE_URL": "Nextcloud Base URL",
    "USERNAME": "Your Nextcloud username",
    "PASSWORD": "Your Nextcloud app password",
    "FILTER_BY_ASSIGNEE": "Only import cards assigned to me",
    "IS_TRANSITION_ISSUES_ENABLED": "Sync completion status and title back to Nextcloud Deck"
  },
  "FORM_SECTION": {
    "HELP": "Configure your Nextcloud Deck integration to import cards as tasks. Use an app password for authentication."
  },
  "ISSUE_CONTENT": {
    "DECK_DESCRIPTION": "Deck Description",
    "STACK": "Stack",
    "ASSIGNED_USERS": "Assigned Users",
    "LABELS": "Labels"
  },
  "S": {
    "BOARD_NOT_FOUND": "Nextcloud Deck: Board not found",
    "CARD_NOT_FOUND": "Nextcloud Deck: Card \"{{issueId}}\" seems to be deleted on server."
  }
},
```

**Step 2: Add translation constants to `t.const.ts`**

Find the `CALDAV` section (around line 101) and add after it:

```typescript
NEXTCLOUD_DECK: {
  FORM: {
    BASE_URL: 'F.NEXTCLOUD_DECK.FORM.BASE_URL',
    USERNAME: 'F.NEXTCLOUD_DECK.FORM.USERNAME',
    PASSWORD: 'F.NEXTCLOUD_DECK.FORM.PASSWORD',
    FILTER_BY_ASSIGNEE: 'F.NEXTCLOUD_DECK.FORM.FILTER_BY_ASSIGNEE',
    IS_TRANSITION_ISSUES_ENABLED: 'F.NEXTCLOUD_DECK.FORM.IS_TRANSITION_ISSUES_ENABLED',
  },
  FORM_SECTION: {
    HELP: 'F.NEXTCLOUD_DECK.FORM_SECTION.HELP',
  },
  ISSUE_CONTENT: {
    DECK_DESCRIPTION: 'F.NEXTCLOUD_DECK.ISSUE_CONTENT.DECK_DESCRIPTION',
    STACK: 'F.NEXTCLOUD_DECK.ISSUE_CONTENT.STACK',
    ASSIGNED_USERS: 'F.NEXTCLOUD_DECK.ISSUE_CONTENT.ASSIGNED_USERS',
    LABELS: 'F.NEXTCLOUD_DECK.ISSUE_CONTENT.LABELS',
  },
  S: {
    BOARD_NOT_FOUND: 'F.NEXTCLOUD_DECK.S.BOARD_NOT_FOUND',
    CARD_NOT_FOUND: 'F.NEXTCLOUD_DECK.S.CARD_NOT_FOUND',
  },
},
```

**Step 3: Run checkFile**

```bash
npm run checkFile src/app/t.const.ts
```

**Step 4: Commit**

```bash
git add src/assets/i18n/en.json src/app/t.const.ts
git commit -m "feat(deck): add translation keys"
```

---

### Task 13: SVG Icon

**Files:**
- Create: `src/assets/icons/nextcloud_deck.svg`
- Modify: `src/app/core/theme/global-theme.service.ts`

**Step 1: Create or source an icon**

Create a simple SVG icon for Nextcloud Deck. You can use the Nextcloud Deck logo or a simple deck/kanban board icon. Place it at `src/assets/icons/nextcloud_deck.svg`.

A simple placeholder (kanban board icon):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
  <path d="M3 3h6v10H3V3zm8 0h6v6h-6V3zm8 0h2v14h-2V3zM3 15h6v6H3v-6zm8-4h6v10h-6V11z"/>
</svg>
```

**Step 2: Register in `global-theme.service.ts`**

Find the icon registration array (where `caldav` is registered, around line 165) and add:

```typescript
['nextcloud_deck', 'assets/icons/nextcloud_deck.svg'],
```

**Step 3: Commit**

```bash
git add src/assets/icons/nextcloud_deck.svg src/app/core/theme/global-theme.service.ts
git commit -m "feat(deck): add provider icon"
```

---

### Task 14: Effects Registration

**Files:**
- Find and modify the file where `CaldavIssueEffects` is registered in `EffectsModule.forRoot()` or `provideEffects()`.

**Step 1: Find effects registration**

```bash
# Search for CaldavIssueEffects registration
grep -r "CaldavIssueEffects" src/ --include="*.ts" -l
```

**Step 2: Add `NextcloudDeckIssueEffects` in the same location**

Import and add to the effects array:

```typescript
import { NextcloudDeckIssueEffects } from './providers/nextcloud-deck/nextcloud-deck-issue.effects';
```

Add `NextcloudDeckIssueEffects` alongside `CaldavIssueEffects` in the effects array.

**Step 3: Commit**

```bash
git commit -am "feat(deck): register effects module"
```

---

### Task 15: Verify Build

**Step 1: Run lint**

```bash
npm run lint
```

**Step 2: Fix any lint/type errors**

Address any TypeScript compilation errors or lint issues.

**Step 3: Run unit tests**

```bash
npm test
```

**Step 4: Manual verification**

```bash
ng serve
```

Open http://localhost:4200, go to Settings → Issue Providers, and verify "Nextcloud Deck" appears as an option with the correct form fields.

**Step 5: Final commit if needed**

```bash
git commit -am "fix(deck): address build issues"
```

---

## Task Dependency Order

```
Task 1 (models) → Task 2 (constants) → Task 3 (type system) → Task 4 (const maps)
Task 5 (API client) — can run in parallel with Tasks 3-4
Task 6 (issue content) — depends on Task 1
Task 7 (config form) — depends on Tasks 3, 6
Task 8 (common interfaces) — depends on Tasks 1, 2, 5
Task 9 (register service) — depends on Tasks 4, 8
Task 10 (content registration) — depends on Task 6
Task 11 (effects) — depends on Tasks 5, 8
Task 12 (translations) — depends on Tasks 6, 7
Task 13 (icon) — independent
Task 14 (effects registration) — depends on Task 11
Task 15 (verify) — depends on all above
```
