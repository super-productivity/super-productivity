import { handleIosBackground, IosBackgroundDeps } from './handle-ios-background';

describe('handleIosBackground', () => {
  let calls: string[];
  let deps: IosBackgroundDeps;

  beforeEach(() => {
    calls = [];
    deps = {
      flushAccumulatedTimeSpent: () => void calls.push('flushTime'),
      pushPendingOps: async () => void calls.push('push'),
      finish: () => void calls.push('finish'),
    };
  });

  it('flushes tracked time, pushes, then finishes the background task', async () => {
    await handleIosBackground(deps);
    expect(calls).toEqual(['flushTime', 'push', 'finish']);
  });

  it('still pushes and finishes when the time flush throws', async () => {
    // Like Android: ops persisted earlier are still worth sending.
    deps.flushAccumulatedTimeSpent = () => {
      throw new Error('flush');
    };
    await handleIosBackground(deps);
    expect(calls).toEqual(['push', 'finish']);
  });

  it('finishes the background task when the push rejects', async () => {
    deps.pushPendingOps = () => Promise.reject(new Error('push'));
    await handleIosBackground(deps);
    expect(calls).toEqual(['flushTime', 'finish']);
  });
});
