import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  Input,
  OnDestroy,
  OnInit,
  output,
} from '@angular/core';
import { ConfigFormSection } from '../../../../../config/global-config.model';
import { FormlyFormOptions } from '@ngx-formly/core';
import {
  FormsModule,
  ReactiveFormsModule,
  UntypedFormControl,
  UntypedFormGroup,
} from '@angular/forms';
import { JiraTransitionConfig, JiraTransitionOption } from '../../jira.model';
import { expandAnimation } from '../../../../../../ui/animations/expand.ani';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import {
  IssueProvider,
  IssueProviderJira,
  SearchResultItem,
} from '../../../../issue.model';
import { catchError, debounceTime, first, map, switchMap, tap } from 'rxjs/operators';
import { JiraApiService } from '../../jira-api.service';
import { DEFAULT_JIRA_CFG } from '../../jira.const';
import { JiraIssue } from '../../jira-issue.model';
import { SnackService } from '../../../../../../core/snack/snack.service';
import { T } from '../../../../../../t.const';
import { HelperClasses } from '../../../../../../app.constants';
import { IssueProviderService } from '../../../../issue-provider.service';
import { assertTruthy } from '../../../../../../util/assert-truthy';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatAutocomplete, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatOption } from '@angular/material/core';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSelect } from '@angular/material/select';
import { MatButton } from '@angular/material/button';
import { AsyncPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { devError } from '../../../../../../util/dev-error';

@Component({
  selector: 'jira-additonal-cfg',
  templateUrl: './jira-additional-cfg.component.html',
  styleUrls: ['./jira-additional-cfg.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandAnimation],
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatSlideToggle,
    MatFormField,
    MatLabel,
    MatInput,
    MatAutocompleteTrigger,
    MatAutocomplete,
    MatOption,
    MatProgressSpinner,
    MatSelect,
    MatButton,
    AsyncPipe,
    TranslatePipe,
  ],
})
export class JiraAdditionalCfgComponent implements OnInit, OnDestroy {
  private _jiraApiService = inject(JiraApiService);
  private _snackService = inject(SnackService);
  private _issueProviderService = inject(IssueProviderService);

  readonly section = input<ConfigFormSection<IssueProviderJira>>();

  readonly modelChange = output<IssueProviderJira>();

  T: typeof T = T;
  HelperClasses: typeof HelperClasses = HelperClasses;
  issueSuggestionsCtrl: UntypedFormControl = new UntypedFormControl();
  customFieldSuggestionsCtrl: UntypedFormControl = new UntypedFormControl();
  customFields: any[] = [];
  customFieldsPromise?: Promise<any>;
  isLoading$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  form: UntypedFormGroup = new UntypedFormGroup({});
  options: FormlyFormOptions = {};

  filteredIssueSuggestions$: Observable<SearchResultItem[]> =
    this.issueSuggestionsCtrl.valueChanges.pipe(
      debounceTime(300),
      tap(() => this.isLoading$.next(true)),
      switchMap((searchTerm: string) => {
        return searchTerm && searchTerm.length > 1
          ? this._issueProviderService.getCfgOnce$(this.cfg.id, 'JIRA').pipe(
              first(),
              switchMap((cfg) => this._jiraApiService.issuePicker$(searchTerm, cfg)),
              catchError(() => {
                return [];
              }),
            )
          : // Note: the outer array signifies the observable stream the other is the value
            [[]];
        // TODO fix type
      }),
      tap((suggestions) => {
        this.isLoading$.next(false);
      }),
    );
  filteredCustomFieldSuggestions$: Observable<any[]> =
    this.customFieldSuggestionsCtrl.valueChanges.pipe(
      map((value) => this._filterCustomFieldSuggestions(value)),
    );
  transitionConfigOpts: {
    key: keyof JiraTransitionConfig;
    val: JiraTransitionOption | undefined;
  }[] = [];

  private _subs: Subscription = new Subscription();

  private _cfg?: IssueProviderJira;

  get cfg(): IssueProviderJira {
    return this._cfg as IssueProviderJira;
  }

  // NOTE: this is legit because it might be that there is no issue provider cfg yet
  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input() set cfg(cfg: IssueProviderJira) {
    const newCfg: IssueProviderJira = { ...cfg };
    const isEqual = JSON.stringify(newCfg) === JSON.stringify(this._cfg);
    if (isEqual) {
      return;
    }

    if (!newCfg.transitionConfig) {
      newCfg.transitionConfig = DEFAULT_JIRA_CFG.transitionConfig;
    } else {
      // CLEANUP keys that we're not using
      // needs to made writeable first
      newCfg.transitionConfig = { ...newCfg.transitionConfig };
      Object.keys(newCfg.transitionConfig).forEach((key: string) => {
        if (!(key in DEFAULT_JIRA_CFG.transitionConfig)) {
          delete (newCfg.transitionConfig as any)[key];
        }
      });
    }

    if (!Array.isArray(newCfg.availableTransitions)) {
      newCfg.availableTransitions = DEFAULT_JIRA_CFG.availableTransitions;
    }

    this._cfg = newCfg;

    this.transitionConfigOpts = Object.keys(newCfg.transitionConfig).map((k: string) => {
      const key = k as keyof JiraTransitionConfig;
      return {
        key,
        val: newCfg.transitionConfig[key],
      };
    });
  }

  ngOnInit(): void {
    this._subs.add(
      this.customFieldSuggestionsCtrl.valueChanges.subscribe((value) => {
        this.partialModelChange({ storyPointFieldId: value });
      }),
    );
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  partialModelChange(cfg: Partial<IssueProviderJira>): void {
    // NOTE: this currently throws an error when loading issue point stuff for jira
    try {
      Object.keys(cfg).forEach((key) => {
        if (key !== 'isEnabled') {
          this._cfg![key] = cfg[key];
        }
      });
    } catch (e) {
      devError(e);
      const updates: any = {};
      Object.keys(cfg).forEach((key) => {
        if (key !== 'isEnabled') {
          updates[key] = cfg[key as keyof IssueProvider];
        }
      });
      this._cfg = { ...this._cfg, ...updates };
    }
    this.notifyModelChange();
  }

  getTransition(key: keyof JiraTransitionConfig): JiraTransitionOption | undefined {
    return this.cfg.transitionConfig[key];
  }

  setTransition(key: keyof JiraTransitionConfig, value: JiraTransitionOption): void {
    this.partialModelChange({
      transitionConfig: {
        ...this.cfg.transitionConfig,
        [key]: value,
      },
    });
  }

  notifyModelChange(): void {
    this.modelChange.emit(this._cfg as IssueProviderJira);
  }

  trackByCustomFieldId(i: number, field: any): string {
    return field.id;
  }

  displayIssueWith(issue?: JiraIssue): string | undefined {
    // NOTE: apparently issue can be undefined for displayWith
    return issue?.summary;
  }

  trackByIssueId(i: number, issue: JiraIssue): string {
    return issue.id;
  }

  loadCustomFields(): void {
    this.customFieldsPromise = this._jiraApiService
      .listFields$(this.cfg as IssueProviderJira)
      .toPromise();
    this.customFieldsPromise.then((v: any) => {
      if (v && Array.isArray(v.response)) {
        this.customFields = v.response;
      }
    });
  }

  updateTransitionOptions(): void {
    const searchResultItem = this.issueSuggestionsCtrl.value as SearchResultItem;
    if (!searchResultItem || typeof (searchResultItem as any) === 'string') {
      this.issueSuggestionsCtrl.setValue('');
      return;
    } else {
      const issueId = assertTruthy(searchResultItem.issueData.id);
      this._subs.add(
        this._jiraApiService
          .getTransitionsForIssue$(issueId.toString(), this.cfg)
          .subscribe((val) => {
            this.partialModelChange({ availableTransitions: val });
            this._snackService.open({
              type: 'SUCCESS',
              msg: T.F.JIRA.S.TRANSITIONS_LOADED,
            });
          }),
      );
    }
  }

  private _filterCustomFieldSuggestions(value: string): string[] {
    const filterValue = value && value.toLowerCase();
    return this.customFields.filter(
      (field) =>
        field &&
        (field.name.toLowerCase().includes(filterValue) ||
          field.id.includes(filterValue)),
    );
  }
}
