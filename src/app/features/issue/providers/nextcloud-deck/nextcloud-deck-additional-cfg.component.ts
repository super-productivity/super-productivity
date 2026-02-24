import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  Input,
  input,
  OnDestroy,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NextcloudDeckApiService } from './nextcloud-deck-api.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { IssueProviderNextcloudDeck } from '../../issue.model';
import { ConfigFormSection } from '../../../config/global-config.model';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatSelect, MatOption } from '@angular/material/select';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { AsyncPipe } from '@angular/common';
import { BehaviorSubject, Subscription, of } from 'rxjs';
import { catchError, first, map, tap } from 'rxjs/operators';
import { T } from '../../../../t.const';

interface DeckBoard {
  id: number;
  title: string;
}

interface DeckStack {
  id: number;
  title: string;
}

@Component({
  selector: 'nextcloud-deck-additional-cfg',
  standalone: true,
  imports: [
    FormsModule,
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption,
    MatButton,
    MatProgressSpinner,
    AsyncPipe,
  ],
  template: `
    <p style="margin-top: 12px">Select a Nextcloud Deck board to import cards from.</p>
    @let boardsLoading = isBoardsLoading$ | async;
    <button
      mat-stroked-button
      color="primary"
      type="button"
      style="margin-bottom: 12px"
      (click)="loadBoards()"
      [disabled]="boardsLoading"
    >
      @if (boardsLoading) {
        <mat-progress-spinner
          diameter="18"
          mode="indeterminate"
          style="display: inline-block; margin-right: 8px"
        ></mat-progress-spinner>
      }
      Load Boards
    </button>

    <mat-form-field
      appearance="outline"
      style="width: 100%"
    >
      <mat-label>Board</mat-label>
      <mat-select
        [(ngModel)]="selectedBoardId"
        (ngModelChange)="onBoardSelect($event)"
      >
        @for (board of boards$ | async; track board.id) {
          <mat-option [value]="board.id">
            {{ board.title }}
          </mat-option>
        }
      </mat-select>
    </mat-form-field>

    @if (selectedBoardId) {
      @let stacksLoading = isStacksLoading$ | async;
      <mat-form-field
        appearance="outline"
        style="width: 100%"
      >
        <mat-label>Import from stacks (leave empty for all)</mat-label>
        <mat-select
          [ngModel]="selectedImportStackIds"
          (ngModelChange)="onImportStacksChange($event)"
          multiple
          [disabled]="stacksLoading"
        >
          @for (stack of stacks$ | async; track stack.id) {
            <mat-option [value]="stack.id">
              {{ stack.title }}
            </mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field
        appearance="outline"
        style="width: 100%"
      >
        <mat-label>Done stack (cards moved here on completion)</mat-label>
        <mat-select
          [ngModel]="selectedDoneStackId"
          (ngModelChange)="onDoneStackChange($event)"
          [disabled]="stacksLoading"
        >
          <mat-option [value]="null">None</mat-option>
          @for (stack of stacks$ | async; track stack.id) {
            <mat-option [value]="stack.id">
              {{ stack.title }}
            </mat-option>
          }
        </mat-select>
      </mat-form-field>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NextcloudDeckAdditionalCfgComponent implements OnDestroy {
  private _deckApiService = inject(NextcloudDeckApiService);
  private _snackService = inject(SnackService);
  private _cdr = inject(ChangeDetectorRef);

  readonly section = input<ConfigFormSection<IssueProviderNextcloudDeck>>();
  readonly modelChange = output<IssueProviderNextcloudDeck>();

  private _cfg?: IssueProviderNextcloudDeck;
  private _boardsList$ = new BehaviorSubject<DeckBoard[]>([]);
  private _boardsLoaded = false;

  selectedBoardId: number | null = null;
  selectedImportStackIds: number[] = [];
  selectedDoneStackId: number | null = null;

  isBoardsLoading$ = new BehaviorSubject<boolean>(false);
  isStacksLoading$ = new BehaviorSubject<boolean>(false);

  boards$ = new BehaviorSubject<DeckBoard[]>([]);
  stacks$ = new BehaviorSubject<DeckStack[]>([]);

  private _subs = new Subscription();

  @Input() set cfg(cfg: IssueProviderNextcloudDeck) {
    this._cfg = cfg;
    this.selectedBoardId = cfg.selectedBoardId ?? null;
    this.selectedImportStackIds = cfg.importStackIds ?? [];
    this.selectedDoneStackId = cfg.doneStackId ?? null;

    // Auto-load boards on first cfg set if credentials are present
    if (!this._boardsLoaded && cfg.nextcloudBaseUrl && cfg.username && cfg.password) {
      this._boardsLoaded = true;
      this._fetchBoards(cfg);
    }
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
    this._boardsList$.complete();
    this.boards$.complete();
    this.stacks$.complete();
    this.isBoardsLoading$.complete();
    this.isStacksLoading$.complete();
  }

  loadBoards(): void {
    if (!this._cfg?.nextcloudBaseUrl || !this._cfg?.username || !this._cfg?.password) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.NEXTCLOUD_DECK.S.ERR_CREDENTIALS_MISSING,
      });
      return;
    }
    this._fetchBoards(this._cfg);
  }

  onBoardSelect(boardId: number | null): void {
    if (!this._cfg) return;
    this.selectedBoardId = boardId;
    this.selectedImportStackIds = [];
    this.selectedDoneStackId = null;
    this.stacks$.next([]);

    const selectedBoard = this._boardsList$.value.find((b) => b.id === boardId);
    const updated: IssueProviderNextcloudDeck = {
      ...this._cfg,
      selectedBoardId: boardId,
      selectedBoardTitle: selectedBoard?.title || null,
      importStackIds: null,
      doneStackId: null,
    };
    this._cfg = updated;
    this.modelChange.emit(updated);

    if (boardId) {
      this._fetchStacks(this._cfg, boardId);
    }
  }

  onImportStacksChange(stackIds: number[]): void {
    if (!this._cfg) return;
    this.selectedImportStackIds = stackIds;
    const updated: IssueProviderNextcloudDeck = {
      ...this._cfg,
      importStackIds: stackIds.length > 0 ? stackIds : null,
    };
    this._cfg = updated;
    this.modelChange.emit(updated);
  }

  onDoneStackChange(stackId: number | null): void {
    if (!this._cfg) return;
    this.selectedDoneStackId = stackId;
    const updated: IssueProviderNextcloudDeck = {
      ...this._cfg,
      doneStackId: stackId,
    };
    this._cfg = updated;
    this.modelChange.emit(updated);
  }

  private _fetchBoards(cfg: IssueProviderNextcloudDeck): void {
    this.isBoardsLoading$.next(true);
    this._cdr.markForCheck();

    this._subs.add(
      this._deckApiService
        .getBoards$(cfg)
        .pipe(
          first(),
          map((boards) => boards.map((b) => ({ id: b.id, title: b.title }))),
          tap((boards) => {
            this._boardsList$.next(boards);
            this.boards$.next(boards);
            this.isBoardsLoading$.next(false);
            this._cdr.markForCheck();

            // Auto-load stacks if a board was already selected
            if (this.selectedBoardId && this._cfg) {
              this._fetchStacks(this._cfg, this.selectedBoardId);
            }
          }),
          catchError(() => {
            this.isBoardsLoading$.next(false);
            this._boardsList$.next([]);
            this.boards$.next([]);
            this._cdr.markForCheck();
            this._snackService.open({
              type: 'ERROR',
              msg: T.F.NEXTCLOUD_DECK.S.ERR_LOAD_BOARDS,
            });
            return of([]);
          }),
        )
        .subscribe(),
    );
  }

  private _fetchStacks(cfg: IssueProviderNextcloudDeck, boardId: number): void {
    this.isStacksLoading$.next(true);
    this._cdr.markForCheck();

    this._subs.add(
      this._deckApiService
        .getStacks$(cfg, boardId)
        .pipe(
          first(),
          map((stacks) => stacks.map((s) => ({ id: s.id, title: s.title }))),
          tap((stacks) => {
            this.stacks$.next(stacks);
            this.isStacksLoading$.next(false);
            this._cdr.markForCheck();
          }),
          catchError(() => {
            this.stacks$.next([]);
            this.isStacksLoading$.next(false);
            this._cdr.markForCheck();
            return of([]);
          }),
        )
        .subscribe(),
    );
  }
}
