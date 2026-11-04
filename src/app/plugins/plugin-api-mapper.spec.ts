import typia from 'typia';
import { SnackCfg } from '@super-productivity/plugin-api';
import { snackCfgToSnackParams } from './plugin-api-mapper';

describe('snackCfgToSnackParams', () => {
  it('maps a plain snack without action fields', () => {
    const params = snackCfgToSnackParams({ msg: 'Hi', type: 'SUCCESS' });

    expect(params).toEqual({ msg: 'Hi', type: 'SUCCESS', ico: undefined });
  });

  it('maps an action to a clickable, longer-lived snack', () => {
    const onClick = jasmine.createSpy('onClick');

    const params = snackCfgToSnackParams({
      msg: 'Track it?',
      action: { label: 'Track', onClick },
    });
    params.actionFn?.();

    expect(params.actionStr).toBe('Track');
    expect(onClick).toHaveBeenCalled();
    expect(params.config?.duration).toBeGreaterThan(3000);
  });

  it('passes the bridge runtime validation with an action callback', () => {
    const cfg: SnackCfg = {
      msg: 'Track it?',
      action: { label: 'Track', onClick: () => undefined },
    };

    expect(() => typia.assert<SnackCfg>(cfg)).not.toThrow();
  });

  it('drops an action without a callback instead of rendering a dead button', () => {
    const cfg = { msg: 'Track it?', action: { label: 'Track' } } as unknown as SnackCfg;

    expect(snackCfgToSnackParams(cfg).actionStr).toBeUndefined();
  });
});
