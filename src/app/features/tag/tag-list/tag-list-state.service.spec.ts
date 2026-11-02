import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { TagListStateService } from './tag-list-state.service';
import { selectTagFeatureState } from '../store/tag.reducer';
import { selectProjectFeatureState } from '../../project/store/project.selectors';
import { selectTaskRepeatCfgFeatureState } from '../../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { TagState } from '../tag.model';
import { ProjectState } from '../../project/project.model';
import { TaskRepeatCfgState } from '../../task-repeat-cfg/task-repeat-cfg.model';

describe('TagListStateService', () => {
  it('shares filtered state signals and follows relevant store changes', () => {
    const tags = { ids: [], entities: {} } as TagState;
    const projects = { ids: [], entities: {} } as ProjectState;
    const repeats = { ids: [], entities: {} } as TaskRepeatCfgState;
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectTagFeatureState, value: tags },
            { selector: selectProjectFeatureState, value: projects },
            { selector: selectTaskRepeatCfgFeatureState, value: repeats },
          ],
        }),
      ],
    });
    const store = TestBed.inject(MockStore);
    const state = TestBed.inject(TagListStateService);
    expect(TestBed.inject(TagListStateService)).toBe(state);
    expect(state.tagState()).toBe(tags);
    expect(state.projectState()).toBe(projects);
    expect(state.repeatCfgState()).toBe(repeats);
    store.refreshState();
    expect(state.tagState()).toBe(tags);
    const changedTags = { ...tags, ids: ['tag-1'] };
    store.overrideSelector(selectTagFeatureState, changedTags);
    store.refreshState();
    expect(state.tagState()).toBe(changedTags);
    expect(state.projectState()).toBe(projects);
  });
});
