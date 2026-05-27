import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { Observable, Subject } from 'rxjs';
import { debounceTime, filter, map, switchMap, takeUntil } from 'rxjs/operators';
import { JiraApiService } from '../jira-api.service';
import { IssueProviderService } from '../../../issue-provider.service';
import { selectEnabledIssueProviders } from '../../../store/issue-provider.selectors';
import { JIRA_TYPE } from '../../../issue.const';
import { IssueProviderJira, SearchResultItem } from '../../../issue.model';
import {
  DialogJiraIssuePickerData,
  JiraIssuePickerResult,
} from './dialog-jira-issue-picker.model';
import { JiraIssueReduced } from '../jira-issue.model';

@Component({
  selector: 'app-dialog-jira-issue-picker',
  templateUrl: './dialog-jira-issue-picker.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncPipe,
    FormsModule,
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatInputModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    TranslateModule,
  ],
})
export class DialogJiraIssuePickerComponent implements OnDestroy {
  private readonly _store = inject(Store);
  private readonly _jiraApiService = inject(JiraApiService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _matDialogRef =
    inject<MatDialogRef<DialogJiraIssuePickerComponent>>(MatDialogRef);
  private readonly _data = inject<DialogJiraIssuePickerData>(MAT_DIALOG_DATA);

  protected readonly selectedProviderId = signal<string>('');
  protected readonly results = signal<JiraIssueReduced[]>([]);
  protected readonly isLoading = signal<boolean>(false);

  readonly jiraProviders$: Observable<IssueProviderJira[]> = this._store
    .select(selectEnabledIssueProviders)
    .pipe(
      map((providers) =>
        providers.filter((p): p is IssueProviderJira => p.issueProviderKey === JIRA_TYPE),
      ),
    );

  private readonly _searchInput$ = new Subject<string>();
  private readonly _destroy$ = new Subject<void>();

  constructor() {
    // Auto-select first Jira provider (or use pre-selected id from dialog data)
    this.jiraProviders$.pipe(takeUntil(this._destroy$)).subscribe((providers) => {
      if (this._data.issueProviderId) {
        this.selectedProviderId.set(this._data.issueProviderId);
      } else if (providers.length > 0 && !this.selectedProviderId()) {
        this.selectedProviderId.set(providers[0].id);
      }
    });

    // Wire search input to debounced API call
    this._searchInput$
      .pipe(
        debounceTime(300),
        filter((term) => term.trim().length > 0),
        switchMap((term) => {
          const providerId = this.selectedProviderId();
          if (!providerId) {
            return [];
          }
          this.isLoading.set(true);
          const sanitized = term.replace(/"/g, '\\"');
          const jql = `text ~ "${sanitized}" ORDER BY updated DESC`;
          return this._issueProviderService
            .getCfgOnce$(providerId, 'JIRA')
            .pipe(switchMap((cfg) => this._jiraApiService.search$(jql, cfg)));
        }),
        takeUntil(this._destroy$),
      )
      .subscribe({
        next: (items: SearchResultItem[]) => {
          this.isLoading.set(false);
          this.results.set(items.map((item) => item.issueData as JiraIssueReduced));
        },
        error: () => {
          this.isLoading.set(false);
          this.results.set([]);
        },
      });
  }

  onSearchInput(term: string): void {
    if (!term.trim()) {
      this.results.set([]);
      return;
    }
    this._searchInput$.next(term);
  }

  select(result: JiraIssueReduced): void {
    const pickResult: JiraIssuePickerResult = {
      issueId: String(result.id),
      issueProviderId: this.selectedProviderId(),
      issueKey: result.key,
      issueSummary: result.summary,
    };
    this._matDialogRef.close(pickResult);
  }

  ngOnDestroy(): void {
    this._destroy$.next();
    this._destroy$.complete();
  }
}
