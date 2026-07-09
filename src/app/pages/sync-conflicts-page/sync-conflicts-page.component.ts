/**
 * SPAP-15 — Sync Conflicts review page (SPAP-12 mockup 2).
 *
 * Two tabs — Unreviewed | History — listing auto-resolved sync conflicts from
 * the device-local journal. Rows are grouped by entity type; expanding a row
 * shows a table of ONLY the differing fields (LOCAL vs REMOTE, winning side
 * marked, plus a CURRENT column when the entity changed since resolution).
 * Unreviewed rows offer KEEP / FLIP (+ bulk actions); History is read-only and
 * renders merged auto-merges as per-field chips.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { MatTab, MatTabGroup, MatTabLabel } from '@angular/material/tabs';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { ConflictJournalService } from '../../op-log/sync/conflict-journal.service';
import {
  ConflictJournalEntry,
  ConflictJournalFieldDiff,
} from '../../op-log/sync/conflict-journal.model';
import {
  SyncConflictUiService,
  StaleState,
} from '../../op-log/sync/sync-conflict-ui.service';
import {
  groupByEntityType,
  mergedFieldSideKey,
  reasonI18nKey,
  shortClientId,
  statusI18nKey,
  winnerI18nKey,
} from '../../op-log/sync/sync-conflict-review.util';
import { CLIENT_ID_PROVIDER } from '../../op-log/util/client-id.provider';

@Component({
  selector: 'sync-conflicts-page',
  templateUrl: './sync-conflicts-page.component.html',
  styleUrls: ['./sync-conflicts-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    DatePipe,
    NgTemplateOutlet,
    MatTabGroup,
    MatTab,
    MatTabLabel,
    MatButton,
    MatIconButton,
    MatIcon,
    MatTooltip,
    TranslatePipe,
  ],
})
export class SyncConflictsPageComponent implements OnInit {
  private readonly _journal = inject(ConflictJournalService);
  private readonly _ui = inject(SyncConflictUiService);
  private readonly _clientIdProvider = inject(CLIENT_ID_PROVIDER);

  readonly T = T;

  readonly selectedTabIndex = signal(0);
  readonly expandedId = signal<string | null>(null);

  private readonly _unreviewed = signal<ConflictJournalEntry[]>([]);
  private readonly _history = signal<ConflictJournalEntry[]>([]);
  private readonly _ownClientId = signal<string | null>(null);
  /** Current entity state per expanded entry, for the stale "current" column. */
  private readonly _staleByEntryId = signal<Record<string, StaleState>>({});

  readonly unreviewed = this._unreviewed.asReadonly();
  readonly history = this._history.asReadonly();

  readonly unreviewedGroups = computed(() => groupByEntityType(this._unreviewed()));
  readonly historyGroups = computed(() => groupByEntityType(this._history()));
  readonly unreviewedCount = computed(() => this._unreviewed().length);

  async ngOnInit(): Promise<void> {
    this._ownClientId.set(await this._clientIdProvider.loadClientId());
    await this.reload();
  }

  async reload(): Promise<void> {
    const [unreviewed, history] = await Promise.all([
      this._journal.list('unreviewed'),
      this._journal.list('history'),
    ]);
    this._unreviewed.set(unreviewed);
    this._history.set(history);
  }

  onTabIndexChange(index: number): void {
    this.selectedTabIndex.set(index);
  }

  async toggleExpand(entry: ConflictJournalEntry): Promise<void> {
    if (this.expandedId() === entry.id) {
      this.expandedId.set(null);
      return;
    }
    this.expandedId.set(entry.id);
    if (!this._staleByEntryId()[entry.id]) {
      const stale = await this._ui.getStaleState(entry);
      this._staleByEntryId.update((m) => ({ ...m, [entry.id]: stale }));
    }
  }

  isExpanded(entry: ConflictJournalEntry): boolean {
    return this.expandedId() === entry.id;
  }

  // ── Row actions ───────────────────────────────────────────────────────────
  async keep(entry: ConflictJournalEntry): Promise<void> {
    await this._ui.keep(entry);
    await this.reload();
  }

  async flip(entry: ConflictJournalEntry): Promise<void> {
    await this._ui.flip(entry);
    await this.reload();
  }

  async keepAll(): Promise<void> {
    await this._ui.keepAll(this._unreviewed());
    await this.reload();
  }

  async flipAll(side: 'local' | 'remote'): Promise<void> {
    await this._ui.flipAllToSide(this._unreviewed(), side);
    await this.reload();
  }

  canFlip(entry: ConflictJournalEntry): boolean {
    return this._ui.canFlip(entry);
  }

  // ── Presentation helpers (template can't import free functions) ────────────
  reasonKey(entry: ConflictJournalEntry): string {
    return reasonI18nKey(entry.reason);
  }

  winnerKey(entry: ConflictJournalEntry): string {
    return winnerI18nKey(entry.winner);
  }

  statusKey(entry: ConflictJournalEntry): string {
    return statusI18nKey(entry.status);
  }

  mergedSideKey(diff: ConflictJournalFieldDiff): string {
    return mergedFieldSideKey(diff);
  }

  isThisDevice(clientId: string): boolean {
    const own = this._ownClientId();
    return !!own && own === clientId;
  }

  shortId(clientId: string): string {
    return shortClientId(clientId);
  }

  /** True once we've loaded state and the entity diverged since resolution. */
  isStale(entry: ConflictJournalEntry): boolean {
    return this._staleByEntryId()[entry.id]?.isStale ?? false;
  }

  currentValue(entry: ConflictJournalEntry, field: string): unknown {
    return this._staleByEntryId()[entry.id]?.current?.[field];
  }

  /** Which side won a given field (marks the kept column). */
  isFieldWonBy(diff: ConflictJournalFieldDiff, side: 'local' | 'remote'): boolean {
    return diff.pickedSide === side;
  }

  /** Human-readable rendering of a captured field value. */
  display(val: unknown): string {
    if (val === null || val === undefined) {
      return '—';
    }
    if (typeof val === 'string') {
      return val;
    }
    if (typeof val === 'number' || typeof val === 'boolean') {
      return String(val);
    }
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
}
