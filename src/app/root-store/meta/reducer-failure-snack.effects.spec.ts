import { TestBed } from '@angular/core/testing';
import { Action } from '@ngrx/store';
import { Subject } from 'rxjs';
import { ReducerFailureSnackEffects } from './reducer-failure-snack.effects';
import { ALL_ACTIONS } from '../../util/local-actions.token';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { reducerFailureGuardMetaReducer } from './reducer-failure-guard.meta-reducer';

describe('ReducerFailureSnackEffects (#10195)', () => {
  let actions$: Subject<Action>;
  let snackService: jasmine.SpyObj<SnackService>;

  beforeEach(() => {
    actions$ = new Subject<Action>();
    snackService = jasmine.createSpyObj('SnackService', ['open']);
    TestBed.configureTestingModule({
      providers: [
        ReducerFailureSnackEffects,
        { provide: ALL_ACTIONS, useValue: actions$ },
        { provide: SnackService, useValue: snackService },
      ],
    });
    TestBed.inject(ReducerFailureSnackEffects).notifyRejectedAction$.subscribe();
  });

  const rejectedAction = (): Action => {
    const action: Action = { type: '[Test] Rejected' };
    (window.confirm as jasmine.Spy).and.returnValue(false);
    reducerFailureGuardMetaReducer<unknown>(() => {
      throw new Error('reducer boom');
    })({}, action);
    (window.confirm as jasmine.Spy).and.returnValue(true);
    return action;
  };

  it('opens an error snack for a rejected action', () => {
    actions$.next(rejectedAction());
    expect(snackService.open).toHaveBeenCalledWith({
      type: 'ERROR',
      msg: T.GLOBAL_SNACK.ACTION_REJECTED,
    });
  });

  it('ignores actions the reducer applied', () => {
    actions$.next({ type: '[Test] Applied' });
    expect(snackService.open).not.toHaveBeenCalled();
  });
});
