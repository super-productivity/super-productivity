import { TestBed } from '@angular/core/testing';
import { Action } from '@ngrx/store';
import { Subject } from 'rxjs';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { createTask } from '../task.test-helper';
import { RecentlyDeletedEffects } from './recently-deleted.effects';
import { RecentlyDeletedService } from './recently-deleted.service';

describe('RecentlyDeletedEffects', () => {
  let actions$: Subject<Action>;
  let service: jasmine.SpyObj<RecentlyDeletedService>;

  beforeEach(() => {
    actions$ = new Subject<Action>();
    service = jasmine.createSpyObj('RecentlyDeletedService', ['recordAction']);
    service.recordAction.and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        RecentlyDeletedEffects,
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        { provide: RecentlyDeletedService, useValue: service },
      ],
    });
    TestBed.inject(RecentlyDeletedEffects).recordLocalDeleteAndRestore$.subscribe();
  });

  // History, the REST API and the issue service restore via restoreTask too;
  // their restored task must leave the trash.
  it('records a restoreTask from outside the trash', () => {
    const action = TaskSharedActions.restoreTask({
      task: createTask({ id: 'a' }),
      subTasks: [],
    });
    actions$.next(action);
    expect(service.recordAction).toHaveBeenCalledOnceWith(action, jasmine.any(Number));
  });

  it('ignores unrelated actions', () => {
    actions$.next({ type: 'unrelated' });
    expect(service.recordAction).not.toHaveBeenCalled();
  });
});
