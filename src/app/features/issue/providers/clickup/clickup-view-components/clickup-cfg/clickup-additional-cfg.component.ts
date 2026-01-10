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
import { FormsModule, ReactiveFormsModule, UntypedFormGroup } from '@angular/forms';
import { expandAnimation } from '../../../../../../ui/animations/expand.ani';
import { BehaviorSubject, Subscription, forkJoin } from 'rxjs';
import { IssueProviderClickUp } from '../../../../issue.model';
import { first, tap } from 'rxjs/operators';
import { ClickUpApiService } from '../../clickup-api.service';
import { DEFAULT_CLICKUP_CFG } from '../../clickup.const';
import { SnackService } from '../../../../../../core/snack/snack.service';
import { T } from '../../../../../../t.const';
import { HelperClasses } from '../../../../../../app.constants';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { AsyncPipe } from '@angular/common';
import { ClickUpTeam } from '../../clickup.model';
import { CollapsibleComponent } from '../../../../../../ui/collapsible/collapsible.component';

@Component({
  selector: 'clickup-additional-cfg',
  templateUrl: './clickup-additional-cfg.component.html',
  styleUrls: ['./clickup-additional-cfg.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandAnimation],
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatProgressSpinner,
    MatButton,
    MatCheckbox,
    AsyncPipe,
    CollapsibleComponent,
  ],
  standalone: true,
})
export class ClickUpAdditionalCfgComponent implements OnInit, OnDestroy {
  private _clickUpApiService = inject(ClickUpApiService);
  private _snackService = inject(SnackService);

  readonly section = input<ConfigFormSection<IssueProviderClickUp>>();
  readonly modelChange = output<IssueProviderClickUp>();

  T: typeof T = T;
  HelperClasses: typeof HelperClasses = HelperClasses;
  form: UntypedFormGroup = new UntypedFormGroup({});
  options: FormlyFormOptions = {};

  availableTeams$: BehaviorSubject<ClickUpTeam[]> = new BehaviorSubject<ClickUpTeam[]>(
    [],
  );
  isLoadingTeams$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  isWorkspaceSelectionExpanded = false;

  private _subs: Subscription = new Subscription();
  private _cfg?: IssueProviderClickUp;
  private _boundCfg?: IssueProviderClickUp;

  get cfg(): IssueProviderClickUp {
    return this._boundCfg as IssueProviderClickUp;
  }

  @Input() set cfg(cfg: IssueProviderClickUp) {
    this._boundCfg = cfg;

    const newCfg: IssueProviderClickUp = { ...cfg };
    const isEqual = JSON.stringify(newCfg) === JSON.stringify(this._cfg);
    if (isEqual) {
      return;
    }

    if (!newCfg.teamIds) {
      newCfg.teamIds = DEFAULT_CLICKUP_CFG.teamIds;
    }

    this._cfg = newCfg;
  }

  ngOnInit(): void {
    // Auto-load teams if API key is present
    if (this.cfg.apiKey) {
      this.loadAvailableTeams();
    }
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  partialModelChange(cfg: Partial<IssueProviderClickUp>): void {
    this._cfg = { ...this.cfg, ...cfg } as IssueProviderClickUp;
    this.notifyModelChange();
  }

  notifyModelChange(): void {
    this.modelChange.emit(this._cfg as IssueProviderClickUp);
  }

  loadAvailableTeams(): void {
    if (!this.cfg?.apiKey) {
      this._snackService.open({
        type: 'ERROR',
        msg: 'Please enter your API key first',
      });
      return;
    }

    this.isLoadingTeams$.next(true);
    this._subs.add(
      forkJoin({
        teams: this._clickUpApiService.getAuthorizedTeams$(this.cfg),
        user: this._clickUpApiService.getCurrentUser$(this.cfg),
      })
        .pipe(
          first(),
          tap(() => this.isLoadingTeams$.next(false)),
        )
        .subscribe({
          next: ({ teams, user }) => {
            this.availableTeams$.next(teams);

            // Save user ID to configuration
            if (user && user.user && user.user.id) {
              this.partialModelChange({ userId: user.user.id });
            }

            this._snackService.open({
              type: 'SUCCESS',
              msg: `Loaded ${teams.length} workspace(s)`,
            });
          },
          error: (err) => {
            this.isLoadingTeams$.next(false);
            this._snackService.open({
              type: 'ERROR',
              msg: 'Failed to load workspaces. Please check your API key.',
            });
          },
        }),
    );
  }

  isTeamSelected(teamId: string): boolean {
    return this.cfg.teamIds?.includes(teamId) || false;
  }

  toggleTeam(teamId: string, isChecked: boolean): void {
    const currentTeamIds = this.cfg.teamIds || [];
    let newTeamIds: string[];

    if (isChecked) {
      // Add team if not already present
      newTeamIds = currentTeamIds.includes(teamId)
        ? currentTeamIds
        : [...currentTeamIds, teamId];
    } else {
      // Remove team
      newTeamIds = currentTeamIds.filter((id) => id !== teamId);
    }

    this.partialModelChange({ teamIds: newTeamIds });
  }

  trackByTeamId(index: number, team: ClickUpTeam): string {
    return team.id;
  }
}
