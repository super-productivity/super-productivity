import { toActiveWorkContext } from './active-work-context.util';
import {
  WorkContext,
  WorkContextType,
} from '../../features/work-context/work-context.model';
import { TODAY_TAG } from '../../features/tag/tag.const';

describe('toActiveWorkContext', () => {
  const makeCtx = (overrides: Partial<WorkContext> = {}): WorkContext => ({
    type: WorkContextType.PROJECT,
    id: 'project-1',
    title: 'Project',
    taskIds: [],
    backlogTaskIds: [],
    noteIds: [],
    theme: {} as WorkContext['theme'],
    advancedCfg: {} as WorkContext['advancedCfg'],
    routerLink: '/project/project-1',
    isEnableBacklog: true,
    icon: null,
    ...overrides,
  });

  it('carries id and title through unchanged', () => {
    const result = toActiveWorkContext(makeCtx({ id: 'p-99', title: 'My Project' }));
    expect(result.id).toBe('p-99');
    expect(result.title).toBe('My Project');
  });

  it("reports type 'PROJECT' for a project context", () => {
    expect(toActiveWorkContext(makeCtx({ type: WorkContextType.PROJECT })).type).toBe(
      'PROJECT',
    );
  });

  it("reports type 'TAG' for an ordinary tag context", () => {
    const ctx = makeCtx({ type: WorkContextType.TAG, id: 'tag-1' });
    expect(toActiveWorkContext(ctx).type).toBe('TAG');
  });

  it("reports type 'TODAY' for the Today tag even though its host type is TAG", () => {
    const ctx = makeCtx({ type: WorkContextType.TAG, id: TODAY_TAG.id });
    expect(toActiveWorkContext(ctx).type).toBe('TODAY');
  });

  it('copies taskIds defensively — the result does not share the source array', () => {
    const sourceTaskIds = ['t1', 't2'];
    const ctx = makeCtx({ taskIds: sourceTaskIds });
    const result = toActiveWorkContext(ctx);

    expect(result.taskIds).toEqual(['t1', 't2']);
    expect(result.taskIds).not.toBe(sourceTaskIds);

    result.taskIds.push('t3');
    expect(sourceTaskIds).toEqual(['t1', 't2']);
  });
});
