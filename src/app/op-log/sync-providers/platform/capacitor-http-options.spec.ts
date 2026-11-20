import { toCapacitorHttpOptions } from './capacitor-http-options';

describe('toCapacitorHttpOptions', () => {
  const superSyncRequest = {
    url: 'https://sync.example.com/api/sync/ops',
    method: 'POST',
    headers: {},
    connectTimeout: 10000,
    readTimeout: 75000,
  };

  it('gives iOS the 75s read budget instead of the 10s connect timeout (#11830)', () => {
    const opts = toCapacitorHttpOptions(superSyncRequest, true);

    expect(opts.connectTimeout).toBeUndefined();
    expect(opts.readTimeout).toBe(75000);
    expect(opts.url).toBe('https://sync.example.com/api/sync/ops');
    expect(superSyncRequest.connectTimeout).toBe(10000);
  });

  it('leaves connect and read timeouts unchanged on Android', () => {
    expect(toCapacitorHttpOptions(superSyncRequest, false)).toEqual(superSyncRequest);
  });

  it('keeps a lone connect timeout on iOS so the request is still bounded', () => {
    const opts = toCapacitorHttpOptions({ url: 'u', connectTimeout: 10000 }, true);

    expect(opts.connectTimeout).toBe(10000);
  });
});
