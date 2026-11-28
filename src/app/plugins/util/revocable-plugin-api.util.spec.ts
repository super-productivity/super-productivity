import { withRevocableApi } from './revocable-plugin-api.util';

describe('withRevocableApi', () => {
  const createApi = (): { addTask: jasmine.Spy; version: string } => ({
    addTask: jasmine.createSpy('addTask').and.returnValue('task-id'),
    version: '1.0.0',
  });

  it('passes calls through before revoke', () => {
    const inner = createApi();
    const { api } = withRevocableApi(inner, () => undefined);

    expect(api.addTask('x')).toBe('task-id');
    expect(inner.addTask).toHaveBeenCalledOnceWith('x');
  });

  it('blocks method calls after revoke and reports each member once', () => {
    const inner = createApi();
    const onBlocked = jasmine.createSpy('onBlocked');
    const { api, revoke } = withRevocableApi(inner, onBlocked);

    revoke();
    api.addTask('x');
    api.addTask('y');

    expect(inner.addTask).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledOnceWith('addTask');
  });

  it('returns a promise that never settles, so awaiting code halts quietly', async () => {
    const { api, revoke } = withRevocableApi(createApi(), () => undefined);
    revoke();

    const settled = jasmine.createSpy('settled');
    (api.addTask('x') as unknown as Promise<unknown>).then(settled, settled);
    await new Promise((r) => setTimeout(r, 0));

    expect(settled).not.toHaveBeenCalled();
  });

  it('keeps plain values readable after revoke', () => {
    const { api, revoke } = withRevocableApi(createApi(), () => undefined);
    revoke();

    expect(api.version).toBe('1.0.0');
  });
});
