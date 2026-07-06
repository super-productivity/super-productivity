import { isSameActiveWorkContext } from './is-same-active-work-context.util';
import { WorkContext, WorkContextType } from './work-context.model';

const baseCtx = (): WorkContext =>
  ({
    id: 'ctx1',
    type: WorkContextType.TAG,
    title: 'x',
    icon: null,
    routerLink: 'tag/ctx1',
    isEnableBacklog: true,
    theme: {},
    advancedCfg: {},
    taskIds: ['A', 'B'],
    backlogTaskIds: ['C'],
    noteIds: ['N'],
  }) as unknown as WorkContext;

describe('isSameActiveWorkContext', () => {
  it('returns true for the same reference', () => {
    const a = baseCtx();
    expect(isSameActiveWorkContext(a, a)).toBe(true);
  });

  it('returns true for different-reference objects with identical content (incl. fresh taskIds array)', () => {
    const a = baseCtx();
    // Models a per-tick re-run: stable object refs (theme/advancedCfg) are
    // shared, arrays are freshly regenerated with the same values.
    const b = {
      ...a,
      taskIds: [...a.taskIds],
      backlogTaskIds: [...(a.backlogTaskIds as string[])],
      noteIds: [...a.noteIds],
    } as unknown as WorkContext;
    expect(a).not.toBe(b);
    expect(a.taskIds).not.toBe(b.taskIds);
    expect(isSameActiveWorkContext(a, b)).toBe(true);
  });

  it('returns false when taskIds content differs', () => {
    const a = baseCtx();
    const b = { ...a, taskIds: ['A', 'X'] } as unknown as WorkContext;
    expect(isSameActiveWorkContext(a, b)).toBe(false);
  });

  it('returns false when backlogTaskIds content differs', () => {
    const a = baseCtx();
    const b = { ...a, backlogTaskIds: ['Z'] } as unknown as WorkContext;
    expect(isSameActiveWorkContext(a, b)).toBe(false);
  });

  it('returns false when noteIds content differs', () => {
    const a = baseCtx();
    const b = { ...a, noteIds: ['N', 'M'] } as unknown as WorkContext;
    expect(isSameActiveWorkContext(a, b)).toBe(false);
  });

  it('returns false when title changes', () => {
    const a = baseCtx();
    const b = { ...a, title: 'y' } as unknown as WorkContext;
    expect(isSameActiveWorkContext(a, b)).toBe(false);
  });

  it('returns false when theme is a new object reference', () => {
    const a = baseCtx();
    const b = { ...a, theme: {} } as unknown as WorkContext;
    expect(a.theme).not.toBe(b.theme);
    expect(isSameActiveWorkContext(a, b)).toBe(false);
  });

  it('returns false when advancedCfg is a new reference', () => {
    const a = baseCtx();
    const b = { ...a, advancedCfg: {} } as unknown as WorkContext;
    expect(a.advancedCfg).not.toBe(b.advancedCfg);
    expect(isSameActiveWorkContext(a, b)).toBe(false);
  });

  it('returns false when isEnableBacklog changes', () => {
    const a = baseCtx();
    const b = { ...a, isEnableBacklog: false } as unknown as WorkContext;
    expect(isSameActiveWorkContext(a, b)).toBe(false);
  });

  it('returns false when icon changes', () => {
    const a = baseCtx();
    const b = { ...a, icon: 'star' } as unknown as WorkContext;
    expect(isSameActiveWorkContext(a, b)).toBe(false);
  });

  it('returns false when the key counts differ (extra key)', () => {
    const a = baseCtx();
    const b = { ...a, extraKey: 'boom' } as unknown as WorkContext;
    expect(isSameActiveWorkContext(a, b)).toBe(false);
  });
});
