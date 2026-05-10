import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ErrorCardComponent } from '../../../ui/error-card/error-card.component';
import { IssuePreviewItemComponent } from '../issue-preview-item/issue-preview-item.component';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { DropListService } from '../../../core-ui/drop-list/drop-list.service';
import { IssueService } from '../../issue/issue.service';
import {
  IssueProvider,
  IssueProviderCalendar,
  SearchResultItem,
} from '../../issue/issue.model';
import { CdkDropList } from '@angular/cdk/drag-drop';
import { T } from 'src/app/t.const';
import { ICalIssueReduced } from '../../issue/providers/calendar/calendar.model';
import { getErrorTxt } from 'src/app/util/get-error-text';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { ShortTimePipe } from '../../../ui/pipes/short-time.pipe';
import { standardListAnimation } from '../../../ui/animations/standard-list.ani';
import { Log } from '../../../core/log';
import { loadFromRealLs, saveToRealLs } from '../../../core/persistence/local-storage';
import { LS } from '../../../core/persistence/storage-keys.const';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { passesCalendarEventRegexFilter } from '../../calendar-integration/calendar-event-regex-filter';

@Component({
  selector: 'issue-panel-calendar-agenda',
  imports: [
    ErrorCardComponent,
    IssuePreviewItemComponent,
    MatProgressSpinner,
    LocaleDatePipe,
    ShortTimePipe,
    MatIcon,
    TranslatePipe,
  ],
  templateUrl: './issue-panel-calendar-agenda.component.html',
  styleUrl: './issue-panel-calendar-agenda.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [standardListAnimation],
})
export class IssuePanelCalendarAgendaComponent {
  readonly T: typeof T = T;

  dropListService = inject(DropListService);
  private _issueService = inject(IssueService);
  private _loadId = 0;

  issueProvider = input.required<IssueProvider>();
  error = signal<string | undefined>(undefined);
  isLoading = signal(false);
  isShowingCachedData = signal(false);

  readonly dropList = viewChild(CdkDropList);

  agendaItems = signal<
    {
      dayStr: string;
      itemsForDay: SearchResultItem<'ICAL'>[];
    }[]
  >([]);

  private _loadOnProviderChange = effect(() => {
    this._loadAgendaItems(this.issueProvider());
  });

  addIssue(item: SearchResultItem): void {
    const ip = this.issueProvider();

    if (item.issueType !== ip.issueProviderKey) {
      throw new Error('Issue Provider and Search Result Type dont match');
    }

    Log.log('Add issue', item);

    this._issueService.addTaskFromIssue({
      issueDataReduced: item.issueData,
      issueProviderId: ip.id,
      issueProviderKey: ip.issueProviderKey,
    });
  }

  private _loadAgendaItems(provider: IssueProvider): void {
    // this._setAgendaItems([
    //   {
    //     issueType: 'ICAL',
    //     title: 'some title',
    //     titleHighlighted: 'some title',
    //     issueData: {
    //       id: '1',
    //       calProviderId: 'xxx',
    //       title: 'some title',
    //       description: 'description alalala',
    //       start: Date.now(),
    //       duration: 60 * 60 * 1000,
    //     },
    //   },
    //   {
    //     issueType: 'ICAL',
    //     title: 'some title',
    //     titleHighlighted: 'some title',
    //     issueData: {
    //       id: '1',
    //       calProviderId: 'xxx',
    //       title: 'some title',
    //       description: 'description alalala',
    //       // eslint-disable-next-line no-mixed-operators
    //       start: Date.now() + 48 * 60 * 60 * 1000,
    //       duration: 60 * 60 * 1000,
    //     },
    //   },
    // ]);
    const loadId = ++this._loadId;
    this.isLoading.set(true);
    this.error.set(undefined);
    this._issueService
      .searchIssues('', provider.id, provider.issueProviderKey, true)
      .then((items: SearchResultItem[]) => {
        if (loadId !== this._loadId) {
          return;
        }
        this.isLoading.set(false);
        this.isShowingCachedData.set(false);
        const icalItems = items as SearchResultItem<'ICAL'>[];
        this._setAgendaItems(icalItems);
        // Cache successful results
        this._saveToCache(provider.id, icalItems);
      })
      .catch((e) => {
        if (loadId !== this._loadId) {
          return;
        }
        this.isLoading.set(false);
        Log.err(e);
        this.error.set(getErrorTxt(e));
        // Fall back to cached data when fetch fails (offline mode)
        const cachedItems = this._getFromCache(provider.id);
        if (cachedItems) {
          this.isShowingCachedData.set(true);
          this._setAgendaItems(this._filterCachedItemsForProvider(cachedItems, provider));
        } else {
          this._setAgendaItems([]);
        }
      });
  }

  private _filterCachedItemsForProvider(
    items: SearchResultItem<'ICAL'>[],
    provider: IssueProvider,
  ): SearchResultItem<'ICAL'>[] {
    if (provider.issueProviderKey !== 'ICAL') {
      return items;
    }
    const calProvider = provider as IssueProviderCalendar;
    return items.filter((item) =>
      passesCalendarEventRegexFilter(
        item.issueData,
        calProvider.filterIncludeRegex,
        calProvider.filterExcludeRegex,
      ),
    );
  }

  private _setAgendaItems(items: SearchResultItem<'ICAL'>[]): void {
    const agenda = items.reduce(
      (acc, item) => {
        const date = getDbDateStr((item.issueData as ICalIssueReduced).start);

        const existingDay = acc.find((day) => day.dayStr === date);
        if (existingDay) {
          existingDay.itemsForDay.push(item);
        } else {
          acc.push({
            dayStr: date,
            itemsForDay: [item],
          });
        }
        return acc;
      },
      [] as { dayStr: string; itemsForDay: SearchResultItem<'ICAL'>[] }[],
    );

    // sort by start time
    agenda.forEach((day) => {
      day.itemsForDay.sort((a, b) => (a.issueData.start > b.issueData.start ? 1 : -1));
    });

    this.agendaItems.set(agenda.sort((a, b) => (a.dayStr > b.dayStr ? 1 : -1)));
  }

  private _getCacheKey(providerId: string): string {
    return `calendar_agenda:${providerId}`;
  }

  private _getFromCache(providerId: string): SearchResultItem<'ICAL'>[] | null {
    try {
      const cache = loadFromRealLs(LS.ISSUE_SEARCH_CACHE);
      if (!cache || typeof cache !== 'object') {
        return null;
      }
      const key = this._getCacheKey(providerId);
      const cachedItems = (cache as { [key: string]: unknown })[key];
      return Array.isArray(cachedItems)
        ? (cachedItems as SearchResultItem<'ICAL'>[])
        : null;
    } catch (e) {
      Log.warn('Failed to load calendar agenda cache', e);
      return null;
    }
  }

  private _saveToCache(providerId: string, items: SearchResultItem<'ICAL'>[]): void {
    try {
      const cache: { [key: string]: unknown } =
        (loadFromRealLs(LS.ISSUE_SEARCH_CACHE) as { [key: string]: unknown }) || {};
      const key = this._getCacheKey(providerId);
      cache[key] = items;
      saveToRealLs(LS.ISSUE_SEARCH_CACHE, cache);
    } catch (e) {
      Log.warn('Failed to save calendar agenda cache', e);
    }
  }
}
