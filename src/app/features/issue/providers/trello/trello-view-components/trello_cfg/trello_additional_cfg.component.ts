// additional configuration for trello e.g. board selection.

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  input,
  Input,
  OnDestroy,
  OnInit,
  output,
} from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TrelloApiService } from '../../trello-api.service';
import { SnackService } from 'src/app/core/snack/snack.service';
import { IssueProviderTrello } from 'src/app/features/issue/issue.model';
import { ConfigFormSection } from 'src/app/features/config/global-config.model';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatSelect, MatOption } from '@angular/material/select';
import { MatButton } from '@angular/material/button';
import { AsyncPipe } from '@angular/common';
import { BehaviorSubject, Observable, Subscription, of } from 'rxjs';
import { catchError, map, tap, debounceTime, switchMap, startWith } from 'rxjs/operators';

interface TrelloBoard {
  id: string;
  name: string;
}

@Component({
  selector: 'trello-additional-cfg',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption,
    MatButton,
    AsyncPipe,
  ],

  // dynamic template
  // TODO: possibly need to add translation here
  template: `
    <!--section for selecting board-->
    <p style="margin-top: 12px;">Select a Trello Board for searching issues.</p>
    @let isLoading = isLoading$ | async;
    <button
      mat-stroked-button
      color="primary"
      type="button"
      style="margin-bottom: 12px;"
      (click)="reloadBoards()"
      [disabled]="isLoading"
    >
      Load Trello Boards
    </button>
    <mat-form-field
      appearance="outline"
      style="width: 100%;"
    >
      <!--label for showing that this is the board-->
      @if (isLoading) {
        <mat-label>No boards found (yet)...</mat-label>
      }
      <mat-select
        [(ngModel)]="selectedBoardId"
        (ngModelChange)="onBoardSelect($event)"
        [disabled]="!isCredentialsComplete"
      >
        @for (board of boards$ | async; track board.id) {
          <mat-option [value]="board.id">
            {{ board.name }}
          </mat-option>
        }
        @if ((boards$ | async)?.length === 0 && isCredentialsComplete) {
          <mat-option disabled> No boards available </mat-option>
        }
        @if (!isCredentialsComplete) {
          <mat-option disabled> Enter API key and token first </mat-option>
        }
      </mat-select>
    </mat-form-field>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrelloAdditionalCfgComponent implements OnInit, OnDestroy {
  // inject some of the service
  private _trelloApiService = inject(TrelloApiService);
  private _snackService = inject(SnackService);
  private _cdr = inject(ChangeDetectorRef);

  // inputs and outputs
  readonly section = input<ConfigFormSection<IssueProviderTrello>>();
  readonly modelChange = output<IssueProviderTrello>();

  // state
  private _cfg?: IssueProviderTrello;
  private _credentialsChanged$ = new BehaviorSubject<IssueProviderTrello | null>(null);
  private _boardsList$ = new BehaviorSubject<TrelloBoard[]>([]);

  selectedBoardId?: string | null;
  isCredentialsComplete = false;

  boards$: Observable<TrelloBoard[]>;
  // lets make it true at first (since we load data when user first change their board)
  isLoading$ = new BehaviorSubject<boolean>(true);

  private _subs = new Subscription();

  constructor() {
    // Initialize boards$ with proper debounce and switchMap
    this.boards$ = this._credentialsChanged$.pipe(
      debounceTime(1000), // Wait 1 seconds after user stops typing
      switchMap((cfg) => {
        // Check if we have minimum required credentials (apiKey and token)
        if (!cfg || !cfg.apiKey || !cfg.token) {
          this.isCredentialsComplete = false;
          this.isLoading$.next(false);
          this._boardsList$.next([]);
          this._cdr.markForCheck();
          return of<TrelloBoard[]>([]);
        }

        this.isCredentialsComplete = true;
        this.isLoading$.next(true);
        this._cdr.markForCheck();

        // Create a temporary config with a placeholder boardId for the API call
        const tempCfgForFetch = { ...cfg, boardId: 'temp' };

        // Fetch all boards from user
        return this._trelloApiService.getBoards$(tempCfgForFetch).pipe(
          map((response) => {
            // Map Trello API response to our format
            const boards = (response || []).map((board: any) => ({
              id: board.id,
              name: board.name,
            }));
            // Store boards in BehaviorSubject so we can access them later
            this._boardsList$.next(boards);
            return boards;
          }),
          tap(() => {
            this.isLoading$.next(false);
            this._cdr.markForCheck();
          }),
          catchError((error) => {
            console.error('Trello Fetch Boards Error:', error);
            this.isLoading$.next(false);
            this._boardsList$.next([]);
            this._cdr.markForCheck();
            // Show error notification
            this._snackService.open({
              type: 'ERROR',
              msg:
                'Failed to load Trello boards. Check your API credentials. Error: ' +
                (error?.message || error?.statusText || 'Unknown'),
              isSkipTranslate: true,
            });
            return of<TrelloBoard[]>([]);
          }),
        );
      }),
      startWith<TrelloBoard[]>([]),
    );
  }

  @Input() set cfg(cfg: IssueProviderTrello) {
    this._cfg = cfg;
    this.selectedBoardId = cfg.boardId;
    // Emit credential change to trigger debounced API call
    // Only emit if apiKey or token is present (boardId not required for fetching boards list)
    if (cfg.apiKey || cfg.token) {
      this._credentialsChanged$.next(cfg);
    }
  }

  ngOnInit(): void {
    // Load boards if credentials already exist
    if (this._cfg && (this._cfg.apiKey || this._cfg.token)) {
      this._credentialsChanged$.next(this._cfg);
    }
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
    this._credentialsChanged$.complete();
    this._boardsList$.complete();
  }

  onBoardSelect(boardId: string | null): void {
    if (this._cfg && boardId) {
      // Get the board name from the stored boards list
      const selectedBoard = this._boardsList$.value.find((board) => board.id === boardId);

      const updated: IssueProviderTrello = {
        ...this._cfg,
        boardId,
        boardName: selectedBoard?.name || null, // Add board name
      };
      this._cfg = updated;
      this.modelChange.emit(updated);
    }
  }

  reloadBoards(): void {
    if (!this._cfg || !this._cfg.apiKey || !this._cfg.token) {
      this._snackService.open({
        type: 'ERROR',
        msg: 'Enter API key and token first.',
        isSkipTranslate: true,
      });
      return;
    }

    this.isCredentialsComplete = true;
    this.isLoading$.next(true);
    this._credentialsChanged$.next({ ...this._cfg });
    this._cdr.markForCheck();
  }
}
