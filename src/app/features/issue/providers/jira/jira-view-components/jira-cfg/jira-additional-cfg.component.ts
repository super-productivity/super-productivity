import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  Input,
  OnDestroy,
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
import {
  JiraExtraFieldCfg,
  JiraTransitionConfig,
  JiraTransitionOption,
} from '../../jira.model';
import { expandAnimation } from '../../../../../../ui/animations/expand.ani';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import {
  IssueProvider,
  IssueProviderJira,
  SearchResultItem,
} from '../../../../issue.model';
import {
  catchError,
  debounceTime,
  first,
  map,
  startWith,
  switchMap,
  tap,
} from 'rxjs/operators';
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
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { AsyncPipe } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
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
    MatIconButton,
    MatIcon,
    MatTooltip,
    AsyncPipe,
    TranslatePipe,
  ],
})
export class JiraAdditionalCfgComponent implements OnDestroy {
  private _jiraApiService = inject(JiraApiService);
  private _snackService = inject(SnackService);
  private _issueProviderService = inject(IssueProviderService);
  private _translateService = inject(TranslateService);

  readonly section = input<ConfigFormSection<IssueProviderJira>>();

  readonly modelChange = output<IssueProviderJira>();

  T: typeof T = T;
  HelperClasses: typeof HelperClasses = HelperClasses;
  issueSuggestionsCtrl: UntypedFormControl = new UntypedFormControl();
  extraFields: JiraExtraFieldCfg[] = [];
  fieldIdControls: UntypedFormControl[] = [];
  filteredCustomFieldSuggestions$: Observable<any[]>[] = [];
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

    const storedExtraFields = newCfg.extraFields;
    const legacyLabelKey = T.F.ISSUE.ISSUE_CONTENT.STORY_POINTS;
    this.extraFields = storedExtraFields
      ? storedExtraFields.map((f) => ({ ...f }))
      : newCfg.storyPointFieldId
        ? [
            {
              id: newCfg.storyPointFieldId,
              label: String(
                this._translateService.instant(legacyLabelKey) || legacyLabelKey,
              ),
            },
          ]
        : [];

    this._cfg = newCfg;

    this.transitionConfigOpts = Object.keys(newCfg.transitionConfig).map((k: string) => {
      const key = k as keyof JiraTransitionConfig;
      return {
        key,
        val: newCfg.transitionConfig[key],
      };
    });

    this._syncFieldControls();
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
        // Emit valueChanges so the suggestion streams recompute with the freshly
        // loaded fields (emitEvent: false leaves the dropdown empty). The save
        // subscription ignores unchanged values, so this cannot persist anything.
        this.fieldIdControls.forEach((ctrl) => ctrl.setValue(ctrl.value));
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

  addExtraField(): void {
    this.extraFields = [...this.extraFields, { id: '', label: '' }];
    this._syncFieldControls();
    this._saveExtraFields();
  }

  updateExtraField(index: number, key: keyof JiraExtraFieldCfg, event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    this.extraFields = this.extraFields.map((field, i) =>
      i === index ? { ...field, [key]: value } : field,
    );
    this._saveExtraFields();
  }

  removeExtraField(index: number): void {
    this.extraFields = this.extraFields.filter((_, i) => i !== index);
    this._syncFieldControls();
    this._saveExtraFields();
  }

  private _syncFieldControls(): void {
    if (this.fieldIdControls.length > this.extraFields.length) {
      this.fieldIdControls.length = this.extraFields.length;
      this.filteredCustomFieldSuggestions$.length = this.extraFields.length;
    }
    this.extraFields.forEach((field, i) => {
      let ctrl = this.fieldIdControls[i];
      if (!ctrl) {
        ctrl = new UntypedFormControl(field.id);
        this.fieldIdControls.push(ctrl);
        this.filteredCustomFieldSuggestions$.push(
          ctrl.valueChanges.pipe(
            startWith(field.id),
            map((value: string) => this._filterCustomFieldSuggestions(value)),
          ),
        );
        // Selecting an option and typing both emit valueChanges (selecting does not
        // fire a DOM input event). Write back and save here, resolving the index
        // dynamically so add/remove cannot shift it. Unchanged values are skipped:
        // loadCustomFields only sets values to refresh the suggestion panel.
        this._subs.add(
          ctrl.valueChanges.subscribe((value: string) => {
            const idx = this.fieldIdControls.indexOf(ctrl);
            if (idx < 0 || !this.extraFields[idx]) {
              return;
            }
            const nextId = value || '';
            if (this.extraFields[idx].id === nextId) {
              return;
            }
            this.extraFields[idx] = { ...this.extraFields[idx], id: nextId };
            this._saveExtraFields();
          }),
        );
      } else if (ctrl.value !== field.id) {
        ctrl.setValue(field.id, { emitEvent: false });
      }
    });
  }

  private _filterCustomFieldSuggestions(value: string): any[] {
    const filterValue = (value || '').toLowerCase();
    return this.customFields.filter(
      (field) =>
        field &&
        (String(field.name ?? '')
          .toLowerCase()
          .includes(filterValue) ||
          String(field.id ?? '').includes(filterValue)),
    );
  }

  private _saveExtraFields(): void {
    this.partialModelChange({
      extraFields: this.extraFields.filter((field) => !!field.id && !!field.label),
      storyPointFieldId: null,
    });
  }
}
