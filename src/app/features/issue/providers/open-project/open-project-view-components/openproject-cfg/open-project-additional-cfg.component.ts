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
import {
  FormsModule,
  ReactiveFormsModule,
  UntypedFormControl,
  UntypedFormGroup,
} from '@angular/forms';
import { FormlyFieldConfig, FormlyFormOptions } from '@ngx-formly/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { HelperClasses } from 'src/app/app.constants';
import { SnackService } from 'src/app/core/snack/snack.service';
import { ConfigFormSection } from 'src/app/features/config/global-config.model';
import {
  IssueProviderOpenProject,
  SearchResultItem,
} from 'src/app/features/issue/issue.model';
import { T } from 'src/app/t.const';
import { expandAnimation } from 'src/app/ui/animations/expand.ani';
import { OpenProjectApiService } from '../../open-project-api.service';
import {
  OpenProjectWorkPackage,
  OpenProjectWorkPackageReduced,
} from '../../open-project-issue.model';
import { DEFAULT_OPEN_PROJECT_CFG } from '../../open-project.const';
import {
  OpenProjectTransitionConfig,
  OpenProjectTransitionOption,
} from '../../open-project.model';
import { AsyncPipe } from '@angular/common';
import { MatSlider } from '@angular/material/slider';
import { debounceTime, switchMap, tap } from 'rxjs/operators';
import { assertTruthy } from '../../../../../../util/assert-truthy';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { TranslatePipe } from '@ngx-translate/core';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import {
  MatAutocomplete,
  MatAutocompleteTrigger,
  MatOption,
} from '@angular/material/autocomplete';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSelect } from '@angular/material/select';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatInput } from '@angular/material/input';

@Component({
  selector: 'open-project-additional-cfg',
  templateUrl: './open-project-additional-cfg.component.html',
  styleUrls: ['./open-project-additional-cfg.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    AsyncPipe,
    MatSlider,
    MatSlideToggle,
    ReactiveFormsModule,
    TranslatePipe,
    MatFormField,
    MatAutocompleteTrigger,
    MatAutocomplete,
    MatOption,
    MatProgressSpinner,
    MatSelect,
    MatCheckbox,
    MatInput,
    MatLabel,
  ],
  animations: [expandAnimation],
})
export class OpenProjectAdditionalCfgComponent implements OnInit, OnDestroy {
  private _openProjectApiService = inject(OpenProjectApiService);
  private _snackService = inject(SnackService);

  readonly section = input<ConfigFormSection<IssueProviderOpenProject>>();
  readonly modelChange = output<IssueProviderOpenProject>();
  T: typeof T = T;
  HelperClasses: typeof HelperClasses = HelperClasses;
  issueSuggestionsCtrl: UntypedFormControl = new UntypedFormControl();
  form: UntypedFormGroup = new UntypedFormGroup({});
  isLoading$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  fields?: FormlyFieldConfig[];
  options: FormlyFormOptions = {};

  filteredIssueSuggestions$: Observable<SearchResultItem[]> =
    this.issueSuggestionsCtrl.valueChanges.pipe(
      debounceTime(300),
      tap(() => this.isLoading$.next(true)),
      switchMap((searchTerm: string) => {
        return searchTerm && searchTerm.length > 1
          ? this._openProjectApiService.searchIssueForRepo$(searchTerm, this.cfg)
          : [[]];
      }),
      tap((suggestions) => {
        this.isLoading$.next(false);
      }),
    );
  transitionConfigOpts: {
    key: keyof OpenProjectTransitionConfig;
    val: OpenProjectTransitionOption | undefined;
  }[] = [];

  private _subs: Subscription = new Subscription();

  private _cfg?: IssueProviderOpenProject;

  get cfg(): IssueProviderOpenProject {
    return this._cfg as IssueProviderOpenProject;
  }

  // NOTE: this is legit because it might be that there is no issue provider cfg yet
  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input() set cfg(cfg: IssueProviderOpenProject) {
    const newCfg: IssueProviderOpenProject = { ...cfg };
    const isEqual = JSON.stringify(newCfg) === JSON.stringify(this._cfg);

    if (isEqual) {
      return;
    }

    if (!newCfg.transitionConfig) {
      newCfg.transitionConfig = DEFAULT_OPEN_PROJECT_CFG.transitionConfig;
    } else {
      // CLEANUP keys that we're not using
      // needs to made writeable first
      newCfg.transitionConfig = { ...newCfg.transitionConfig };
      Object.keys(newCfg.transitionConfig).forEach((key: string) => {
        if (!(key in DEFAULT_OPEN_PROJECT_CFG.transitionConfig!)) {
          delete (newCfg.transitionConfig as any)[key];
        }
      });
    }

    if (!Array.isArray(newCfg.availableTransitions)) {
      newCfg.availableTransitions = DEFAULT_OPEN_PROJECT_CFG.availableTransitions;
    }

    this._cfg = newCfg;

    this.transitionConfigOpts = Object.keys(newCfg.transitionConfig!).map((k: string) => {
      const key = k as keyof OpenProjectTransitionConfig;
      return {
        key,
        val: newCfg.transitionConfig![key],
      };
    });
  }

  ngOnInit(): void {
    this.fields = (this.section() as ConfigFormSection<IssueProviderOpenProject>).items;
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  getTransition(
    key: keyof OpenProjectTransitionConfig,
  ): OpenProjectTransitionOption | undefined {
    return this.cfg.transitionConfig?.[key];
  }

  setTransition(
    key: keyof OpenProjectTransitionConfig,
    value: OpenProjectTransitionOption,
  ): OpenProjectTransitionOption {
    const transitionConfig: OpenProjectTransitionConfig = {
      ...this.cfg.transitionConfig!,
    };
    transitionConfig[key] = value;
    if (key === 'DONE') {
      if (value === 'ALWAYS_ASK' || value === 'DO_NOT') {
        this.partialModelChange({ isSetProgressOnTaskDone: false });
      }
    }
    this.partialModelChange({ transitionConfig });

    return value;
  }

  partialModelChange(cfg: Partial<IssueProviderOpenProject>): void {
    Object.keys(cfg).forEach((key) => {
      this._cfg![key] = cfg[key];
    });

    this.notifyModelChange();
  }

  notifyModelChange(): void {
    this.modelChange.emit(this._cfg as IssueProviderOpenProject);
  }

  updateTransitionOptions(): void {
    const searchResultItem = this.issueSuggestionsCtrl.value as SearchResultItem;
    if (!searchResultItem || typeof (searchResultItem as any) === 'string') {
      this.issueSuggestionsCtrl.setValue('');
      return;
    } else {
      const issueId = assertTruthy(searchResultItem.issueData.id);
      const lockVersion = (searchResultItem.issueData as OpenProjectWorkPackageReduced)
        .lockVersion;
      this._subs.add(
        this._openProjectApiService
          .getTransitionsForIssue$(issueId, lockVersion, this.cfg)
          .subscribe((val) => {
            this.partialModelChange({
              availableTransitions: val,
            });
            this._snackService.open({
              type: 'SUCCESS',
              msg: T.F.OPEN_PROJECT.S.TRANSITIONS_LOADED,
            });
          }),
      );
    }
  }

  displayIssueWith(issue?: OpenProjectWorkPackage): string | undefined {
    // NOTE: apparently issue can be undefined for displayWith
    return issue?.subject;
  }

  showSetProgressOption(key: any): boolean {
    const transitionOption = this.getTransition(key)?.valueOf();
    let shouldShow: boolean = false;
    if (key === 'DONE') {
      shouldShow = transitionOption !== 'DO_NOT' && transitionOption !== 'ALWAYS_ASK';
    }
    return shouldShow;
  }

  displayThumbWith(value: number): string {
    return `${value}%`;
  }
}
