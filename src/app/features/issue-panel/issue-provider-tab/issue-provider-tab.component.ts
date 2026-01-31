import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { IssuePreviewItemComponent } from '../issue-preview-item/issue-preview-item.component';
import { MatIcon } from '@angular/material/icon';
import {
  MatFormField,
  MatHint,
  MatLabel,
  MatPrefix,
  MatSuffix,
} from '@angular/material/form-field';
import { DropListService } from '../../../core-ui/drop-list/drop-list.service';
import { T } from 'src/app/t.const';
import { NgClass } from '@angular/common';
import { IssueProvider, SearchResultItem } from '../../issue/issue.model';
import { getIssueProviderTooltip } from '../../issue/mapping-helper/get-issue-provider-tooltip';
import { FormsModule } from '@angular/forms';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { IssueService } from '../../issue/issue.service';
import {
  catchError,
  debounce,
  distinctUntilChanged,
  finalize,
  map,
  switchMap,
  tap,
} from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { from, Observable, of, timer } from 'rxjs';
import { selectAllTaskIssueIdsForIssueProvider } from '../../tasks/store/task.selectors';
import { DialogEditIssueProviderComponent } from '../../issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component';
import { MatDialog } from '@angular/material/dialog';
import { getErrorTxt } from '../../../util/get-error-text';
import { ErrorCardComponent } from '../../../ui/error-card/error-card.component';
import { selectProjectById } from '../../project/store/project.selectors';
import { HelperClasses, IS_WEB_BROWSER } from '../../../app.constants';
import { IssueProviderActions } from '../../issue/store/issue-provider.actions';
import { IS_MOUSE_PRIMARY } from '../../../util/is-mouse-primary';
import { getIssueProviderHelpLink } from '../../issue/mapping-helper/get-issue-provider-help-link';
import { ISSUE_PROVIDER_HUMANIZED } from '../../issue/issue.const';
import { IssuePanelCalendarAgendaComponent } from '../issue-panel-calendar-agenda/issue-panel-calendar-agenda.component';
import { standardListAnimation } from '../../../ui/animations/standard-list.ani';
import { MatIconButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { MatInput } from '@angular/material/input';
import { MatTooltip } from '@angular/material/tooltip';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { Log } from '../../../core/log';

@Component({
  selector: 'issue-provider-tab',
  imports: [
    IssuePreviewItemComponent,
    MatIcon,
    MatFormField,
    MatLabel,
    FormsModule,
    ErrorCardComponent,
    NgClass,
    IssuePanelCalendarAgendaComponent,
    MatIconButton,
    TranslatePipe,
    MatHint,
    MatInput,
    MatSuffix,
    MatPrefix,
    MatTooltip,
    MatProgressSpinner,
  ],
  templateUrl: './issue-provider-tab.component.html',
  styleUrl: './issue-provider-tab.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [standardListAnimation],
})
export class IssueProviderTabComponent implements OnDestroy, AfterViewInit {
  readonly HelperClasses = HelperClasses;
  readonly T: typeof T = T;
  readonly SEARCH_MIN_LENGTH = 1;
  readonly ISSUE_PROVIDER_HUMANIZED = ISSUE_PROVIDER_HUMANIZED;
  protected readonly IS_WEB_EXTENSION_REQUIRED_FOR_JIRA = IS_WEB_BROWSER;

  dropListService = inject(DropListService);
  private _issueService = inject(IssueService);
  private _matDialog = inject(MatDialog);
  private _store = inject(Store);

  issueProvider = input.required<IssueProvider>();
  issueProvider$ = toObservable(this.issueProvider);

  searchText = signal('');
  searchTxt$ = toObservable(this.searchText);

  issueProviderTooltip = computed(() => getIssueProviderTooltip(this.issueProvider()));
  issueProviderHelpLink = computed(() =>
    getIssueProviderHelpLink(this.issueProvider().issueProviderKey),
  );
  error = signal<string | undefined>(undefined);
  isLoading = signal(false);
  isPinned = computed(
    () =>
      this.issueProvider().pinnedSearch === this.searchText() &&
      this.searchText().length > 0,
  );

  defaultProject$ = this.issueProvider$.pipe(
    switchMap((ip) =>
      ip.defaultProjectId
        ? this._store.select(selectProjectById, { id: ip.defaultProjectId })
        : of(null),
    ),
    catchError(() => {
      Log.err('Project not found for issueProvider');
      return of(null);
    }),
  );
  defaultProject = toSignal(this.defaultProject$);

  // TODO add caching in sessionStorage
  issueItems$: Observable<{ added: SearchResultItem[]; notAdded: SearchResultItem[] }> =
    this.searchTxt$.pipe(
      debounce(() => timer(400)),
      switchMap((searchText) => {
        if (searchText.length < this.SEARCH_MIN_LENGTH) {
          this.isLoading.set(false);
          return of({ added: [], notAdded: [] });
        }
        return this.issueProvider$.pipe(
          distinctUntilChanged((a, b) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { pinnedSearch, ...restA } = a;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { pinnedSearch: pinnedSearchB, ...restB } = b;
            return JSON.stringify(restA) === JSON.stringify(restB);
          }),

          tap(() => this.isLoading.set(true)),

          switchMap((issueProvider: IssueProvider) =>
            from(
              this._issueService.searchIssues(
                searchText,
                issueProvider.id,
                issueProvider.issueProviderKey,
              ),
            ).pipe(
              catchError((e) => {
                this.error.set(getErrorTxt(e));
                this.isLoading.set(false);
                return of(true);
              }),
              tap(() => this.isLoading.set(false)),
              map((trueOnErrorOrItems) => {
                if (trueOnErrorOrItems === true) {
                  return [];
                }
                this.error.set(undefined);
                return trueOnErrorOrItems as SearchResultItem[];
              }),
            ),
          ),

          switchMap((items) =>
            this._store
              .select(selectAllTaskIssueIdsForIssueProvider(this.issueProvider()))
              .pipe(
                map((allIssueIdsForProvider) => {
                  const added: SearchResultItem[] = [];
                  const notAdded: SearchResultItem[] = [];
                  for (const item of items) {
                    if (allIssueIdsForProvider.includes(item.issueData.id.toString())) {
                      added.push(item);
                    } else {
                      notAdded.push(item);
                    }
                  }

                  return { added, notAdded };
                }),
              ),
          ),
          finalize(() => this.isLoading.set(false)),
        );
      }),
    );
  issueItems = toSignal(this.issueItems$.pipe(map((v) => v.notAdded)));

  // readonly dropList = viewChild(CdkDropList);
  readonly searchTextEl = viewChild<ElementRef>('searchTextEl');

  private _focusTimeout?: number;

  ngAfterViewInit(): void {
    // this.dropListService.registerDropList(this.dropList!);
    if (this.searchText().length <= 1 && IS_MOUSE_PRIMARY) {
      this._focusTimeout = window.setTimeout(() => {
        this.searchTextEl()?.nativeElement?.focus();
      }, 500);
    }
    this.searchText.set(this.issueProvider().pinnedSearch || '');
  }

  ngOnDestroy(): void {
    // this.dropListService.unregisterDropList(this.dropList!);
    window.clearTimeout(this._focusTimeout);
  }

  pinSearch(): void {
    this._store.dispatch(
      IssueProviderActions.updateIssueProvider({
        issueProvider: {
          id: this.issueProvider().id,
          changes: {
            pinnedSearch: this.searchText(),
          },
        },
      }),
    );
  }

  unPinSearch(): void {
    this._store.dispatch(
      IssueProviderActions.updateIssueProvider({
        issueProvider: {
          id: this.issueProvider().id,
          changes: {
            pinnedSearch: null,
          },
        },
      }),
    );
  }

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

  openSettings(): void {
    this._matDialog.open(DialogEditIssueProviderComponent, {
      restoreFocus: true,
      data: {
        issueProvider: this.issueProvider(),
      },
    });
  }
}
