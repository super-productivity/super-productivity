import { inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { TagState } from '../tag.model';
import { ProjectState } from '../../project/project.model';
import { TaskRepeatCfgState } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { selectTagFeatureState } from '../store/tag.reducer';
import { selectProjectFeatureState } from '../../project/store/project.selectors';
import { selectTaskRepeatCfgFeatureState } from '../../task-repeat-cfg/store/task-repeat-cfg.selectors';

/** Share the three filtered store subscriptions across all task-row tag lists. */
@Injectable({ providedIn: 'root' })
export class TagListStateService {
  private readonly _store = inject(Store);

  readonly tagState = toSignal(this._store.select(selectTagFeatureState), {
    initialValue: { ids: [], entities: {} } as TagState,
  });
  readonly projectState = toSignal(this._store.select(selectProjectFeatureState), {
    initialValue: { ids: [], entities: {} } as ProjectState,
  });
  readonly repeatCfgState = toSignal(
    this._store.select(selectTaskRepeatCfgFeatureState),
    {
      initialValue: { ids: [], entities: {} } as TaskRepeatCfgState,
    },
  );
}
