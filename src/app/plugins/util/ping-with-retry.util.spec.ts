/**
 * Tests for the production pingWithRetry utility used by PluginService
 * to wait for the Node.js IPC bridge on cold boot.
 */
import { fakeAsync, tick } from '@angular/core/testing';
import { pingWithRetry } from './ping-with-retry.util';

describe('pingWithRetry (production utility)', () => {
  it('resolves true immediately when first attempt succeeds', async () => {
    const ping = jasmine.createSpy('ping').and.resolveTo(true);
    const result = await pingWithRetry(ping);
    expect(result).toBe(true);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('retries and resolves true on second attempt', fakeAsync(() => {
    let attempts = 0;
    const ping = (): Promise<boolean> => {
      attempts++;
      return Promise.resolve(attempts >= 2);
    };

    let result: boolean | undefined;
    pingWithRetry(ping).then((r) => (result = r));

    tick(0); // attempt 1 fails
    tick(1000); // wait first retry delay (default [1000, 2000])
    tick(0); // attempt 2 succeeds

    expect(result).toBe(true);
    expect(attempts).toBe(2);
  }));

  it('retries and resolves true on third attempt', fakeAsync(() => {
    let attempts = 0;
    const ping = (): Promise<boolean> => {
      attempts++;
      return Promise.resolve(attempts >= 3);
    };

    let result: boolean | undefined;
    pingWithRetry(ping).then((r) => (result = r));

    tick(0); // attempt 1
    tick(1000); // delay 1
    tick(0); // attempt 2
    tick(2000); // delay 2
    tick(0); // attempt 3 succeeds

    expect(result).toBe(true);
    expect(attempts).toBe(3);
  }));

  it('resolves false after all 3 default attempts fail', fakeAsync(() => {
    const ping = jasmine.createSpy('ping').and.resolveTo(false);

    let result: boolean | undefined;
    pingWithRetry(ping).then((r) => (result = r));

    tick(0);
    tick(1000);
    tick(0);
    tick(2000);
    tick(0);

    expect(result).toBe(false);
    expect(ping).toHaveBeenCalledTimes(3);
  }));

  it('respects custom retry delays', fakeAsync(() => {
    const ping = jasmine.createSpy('ping').and.resolveTo(false);

    let result: boolean | undefined;
    pingWithRetry(ping, [50, 100, 200]).then((r) => (result = r));

    tick(0); // attempt 1
    tick(50); // delay 1
    tick(0); // attempt 2
    tick(100); // delay 2
    tick(0); // attempt 3
    tick(200); // delay 3
    tick(0); // attempt 4 (last)

    expect(result).toBe(false);
    expect(ping).toHaveBeenCalledTimes(4);
  }));

  it('makes exactly one attempt when retryDelays is empty', async () => {
    const ping = jasmine.createSpy('ping').and.resolveTo(false);
    const result = await pingWithRetry(ping, []);
    expect(result).toBe(false);
    expect(ping).toHaveBeenCalledTimes(1);
  });
});
