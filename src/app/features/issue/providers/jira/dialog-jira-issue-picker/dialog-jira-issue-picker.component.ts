import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AsyncPipe } from '@angular/common';
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
import { Observable, Subject, of } from 'rxjs';
import { catchError, debounceTime, filter, map, switchMap } from 'rxjs/operators';
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
import { T } from '../../../../../t.const';

@Component({
  selector: 'app-dialog-jira-issue-picker',
  templateUrl: './dialog-jira-issue-picker.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncPipe,
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
export class DialogJiraIssuePickerComponent {
  private readonly _store = inject(Store);
  private readonly _jiraApiService = inject(JiraApiService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _matDialogRef =
    inject<MatDialogRef<DialogJiraIssuePickerComponent>>(MatDialogRef);
  private readonly _data = inject<DialogJiraIssuePickerData>(MAT_DIALOG_DATA);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly T = T;
  protected readonly selectedProviderId = signal<string>('');
  protected readonly results = signal<JiraIssueReduced[]>([]);
  protected readonly isLoading = signal<boolean>(false);

  protected readonly jiraProviders$: Observable<IssueProviderJira[]> = this._store
    .select(selectEnabledIssueProviders)
    .pipe(
      map((providers) =>
        providers.filter((p): p is IssueProviderJira => p.issueProviderKey === JIRA_TYPE),
      ),
    );

  private readonly _searchInput$ = new Subject<string>();

  constructor() {
    // Auto-select first Jira provider (or use pre-selected id from dialog data)
    this.jiraProviders$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((providers) => {
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
          if (!term.trim() || !providerId) {
            return of<JiraIssueReduced[]>([]);
          }
          this.isLoading.set(true);
          return this._issueProviderService.getCfgOnce$(providerId, 'JIRA').pipe(
            switchMap((cfg) => {
              const sanitized = term.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
              const jql = `text ~ "${sanitized}" ORDER BY updated DESC`;
              return this._jiraApiService.search$(jql, cfg as IssueProviderJira).pipe(
                map((items: SearchResultItem[]) =>
                  items.map((item) => item.issueData as JiraIssueReduced),
                ),
                catchError(() => of<JiraIssueReduced[]>([])),
              );
            }),
          );
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe({
        next: (items: JiraIssueReduced[]) => {
          this.isLoading.set(false);
          this.results.set(items);
        },
        error: () => {
          this.isLoading.set(false);
          this.results.set([]);
        },
      });
  }

  onSearchInput(event: Event): void {
    const term = (event.target as HTMLInputElement).value;
    if (!term.trim()) {
      this.results.set([]);
      this.isLoading.set(false);
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
}
