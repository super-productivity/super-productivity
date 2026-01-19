import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { deleteSection } from './section.actions';
import { map, switchMap, withLatestFrom } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { selectAllTasks } from '../../tasks/store/task.selectors';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';

@Injectable()
export class SectionEffects {
    private actions$ = inject(Actions);
    private store = inject(Store);

    deleteSection$ = createEffect(() =>
        this.actions$.pipe(
            ofType(deleteSection),
            withLatestFrom(this.store.select(selectAllTasks)),
            map(([{ id }, tasks]) => {
                return tasks.filter((t) => t.sectionId === id).map((t) => t.id);
            }),
            switchMap((taskIds) => {
                if (taskIds.length === 0) return [];
                return [TaskSharedActions.deleteTasks({ taskIds })];
            }),
        ),
    );
}
