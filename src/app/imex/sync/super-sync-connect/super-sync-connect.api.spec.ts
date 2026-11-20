import { Capacitor } from '@capacitor/core';
import { SyncLog } from '../../../core/log';
import {
  ConnectPollAnswer,
  ConnectRequest,
  ConnectUnsupportedError,
  connectNativeHttp,
  createConnectRequest,
  MAX_SIGN_IN_WAIT_MS,
  pollConnectRequest,
  PollLoopDeps,
  waitForApproval,
} from './super-sync-connect.api';

const BASE = 'https://sync.example.com';
const REQUEST_ID = 'a'.repeat(22);
const DEVICE = { deviceName: 'Android', platform: 'android' as const };

const jsonResponse = (status: number, body: unknown, headers = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers,
  });

const created = {
  requestId: REQUEST_ID,
  pollSecret: 's'.repeat(43),
  matchCode: 'ABC-DEF',
  expiresAt: Date.now() + 600_000,
  pollIntervalMs: 3000,
};

describe('SuperSync browser sign-in API', () => {
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    fetchSpy = spyOn(window, 'fetch');
    spyOn(SyncLog, 'warn');
  });

  describe('createConnectRequest', () => {
    it('posts the device and returns the request', async () => {
      fetchSpy.and.resolveTo(jsonResponse(200, created));
      const req = await createConnectRequest(BASE, DEVICE);
      expect(req).toEqual({
        requestId: REQUEST_ID,
        pollSecret: created.pollSecret,
        matchCode: 'ABC-DEF',
        pollIntervalMs: 3000,
      });
      const [url, init] = fetchSpy.calls.mostRecent().args;
      expect(url).toBe(`${BASE}/api/connect/requests`);
      expect(JSON.parse(init.body)).toEqual(DEVICE);
    });

    for (const status of [404, 500, 503]) {
      it(`treats HTTP ${status} as a server without browser sign-in`, async () => {
        fetchSpy.and.resolveTo(jsonResponse(status, {}));
        await expectAsync(createConnectRequest(BASE, DEVICE)).toBeRejectedWithError(
          ConnectUnsupportedError,
        );
      });
    }

    it('treats an HTML or malformed answer as a server without browser sign-in', async () => {
      fetchSpy.and.resolveTo(jsonResponse(200, '<html>proxy</html>'));
      await expectAsync(createConnectRequest(BASE, DEVICE)).toBeRejectedWithError(
        ConnectUnsupportedError,
      );
      fetchSpy.and.resolveTo(jsonResponse(200, { ...created, requestId: '../x' }));
      await expectAsync(createConnectRequest(BASE, DEVICE)).toBeRejectedWithError(
        ConnectUnsupportedError,
      );
    });

    it('fails plainly on a rate limit, so the user can try again', async () => {
      fetchSpy.and.resolveTo(jsonResponse(429, {}));
      const error = await createConnectRequest(BASE, DEVICE).catch((e) => e);
      expect(error).toEqual(jasmine.any(Error));
      expect(error).not.toEqual(jasmine.any(ConnectUnsupportedError));
    });

    it('keeps the poll interval within 1 s and 60 s', async () => {
      fetchSpy.and.resolveTo(jsonResponse(200, { ...created, pollIntervalMs: 5 }));
      expect((await createConnectRequest(BASE, DEVICE)).pollIntervalMs).toBe(1000);
      fetchSpy.and.resolveTo(jsonResponse(200, { ...created, pollIntervalMs: 1e9 }));
      expect((await createConnectRequest(BASE, DEVICE)).pollIntervalMs).toBe(60_000);
    });
  });

  describe('pollConnectRequest', () => {
    const request: ConnectRequest = {
      requestId: REQUEST_ID,
      pollSecret: created.pollSecret,
      matchCode: 'ABC-DEF',
      pollIntervalMs: 3000,
    };

    it('sends the poll secret and reads the answer', async () => {
      fetchSpy.and.resolveTo(jsonResponse(200, { status: 'approved', token: 'jwt' }));
      expect(await pollConnectRequest(BASE, request)).toEqual({
        status: 'approved',
        token: 'jwt',
      });
      const [url, init] = fetchSpy.calls.mostRecent().args;
      expect(url).toBe(`${BASE}/api/connect/requests/${REQUEST_ID}/poll`);
      expect(JSON.parse(init.body)).toEqual({ pollSecret: created.pollSecret });
    });

    it('asks to slow down on HTTP 429, with Retry-After when readable', async () => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      fetchSpy.and.resolveTo(jsonResponse(429, {}, { 'Retry-After': '7' }));
      expect(await pollConnectRequest(BASE, request)).toEqual({
        status: 'slow-down',
        retryAfterMs: 7000,
      });
      fetchSpy.and.resolveTo(jsonResponse(429, {}));
      expect(await pollConnectRequest(BASE, request)).toEqual({
        status: 'slow-down',
        retryAfterMs: 0,
      });
    });

    it('rejects an approval without a token and an unknown status', async () => {
      fetchSpy.and.resolveTo(jsonResponse(200, { status: 'approved' }));
      await expectAsync(pollConnectRequest(BASE, request)).toBeRejected();
      fetchSpy.and.resolveTo(jsonResponse(200, { status: 'maybe' }));
      await expectAsync(pollConnectRequest(BASE, request)).toBeRejected();
    });
  });

  // The server's CORS list only has the web app, so a WebView fetch from the
  // native app's https://localhost origin is blocked (#11740).
  describe('on native', () => {
    let httpSpy: jasmine.Spy;
    const request: ConnectRequest = {
      requestId: REQUEST_ID,
      pollSecret: created.pollSecret,
      matchCode: 'ABC-DEF',
      pollIntervalMs: 3000,
    };

    beforeEach(() => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
      httpSpy = spyOn(connectNativeHttp, 'request');
    });

    it('creates the request through native HTTP, not the WebView fetch', async () => {
      httpSpy.and.resolveTo({ status: 200, data: created, headers: {}, url: '' });
      expect((await createConnectRequest(BASE, DEVICE)).matchCode).toBe('ABC-DEF');
      expect(fetchSpy).not.toHaveBeenCalled();
      const opts = httpSpy.calls.mostRecent().args[0];
      expect(opts.url).toBe(`${BASE}/api/connect/requests`);
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.data)).toEqual(DEVICE);
    });

    it('keeps the server-without-sign-in and HTML handling', async () => {
      httpSpy.and.resolveTo({ status: 404, data: '', headers: {}, url: '' });
      await expectAsync(createConnectRequest(BASE, DEVICE)).toBeRejectedWithError(
        ConnectUnsupportedError,
      );
      httpSpy.and.resolveTo({ status: 200, data: '<html>', headers: {}, url: '' });
      await expectAsync(createConnectRequest(BASE, DEVICE)).toBeRejectedWithError(
        ConnectUnsupportedError,
      );
    });

    it('polls through native HTTP and reads Retry-After in any case', async () => {
      httpSpy.and.resolveTo({
        status: 200,
        data: JSON.stringify({ status: 'approved', token: 'jwt' }),
        headers: {},
        url: '',
      });
      expect(await pollConnectRequest(BASE, request)).toEqual({
        status: 'approved',
        token: 'jwt',
      });
      // eslint-disable-next-line @typescript-eslint/naming-convention
      httpSpy.and.resolveTo({ status: 429, data: {}, headers: { 'retry-after': '7' } });
      expect(await pollConnectRequest(BASE, request)).toEqual({
        status: 'slow-down',
        retryAfterMs: 7000,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('waitForApproval', () => {
    // Fake clock: every wait moves time forward by the waited delay.
    const loop = (
      answers: Array<ConnectPollAnswer | Error>,
      isCancelled: () => boolean = () => false,
    ): { deps: PollLoopDeps; waits: number[]; polls: () => number } => {
      let time = 0;
      let calls = 0;
      const waits: number[] = [];
      const deps: PollLoopDeps = {
        poll: async () => {
          const answer = answers[Math.min(calls++, answers.length - 1)];
          if (answer instanceof Error) throw answer;
          return answer;
        },
        wait: async (ms) => {
          waits.push(ms);
          time += ms;
        },
        now: () => time,
        isCancelled,
      };
      return { deps, waits, polls: () => calls };
    };

    it('waits while pending and returns the token once approved', async () => {
      const { deps, waits } = loop([
        { status: 'pending' },
        { status: 'pending' },
        { status: 'approved', token: 'jwt' },
      ]);
      expect(await waitForApproval(3000, deps)).toEqual({
        kind: 'approved',
        token: 'jwt',
      });
      expect(waits).toEqual([3000, 3000, 3000]);
    });

    it('ends on a cancel or expiry in the browser', async () => {
      expect(await waitForApproval(3000, loop([{ status: 'denied' }]).deps)).toEqual({
        kind: 'denied',
      });
      expect(await waitForApproval(3000, loop([{ status: 'expired' }]).deps)).toEqual({
        kind: 'expired',
      });
    });

    it('keeps waiting through network errors', async () => {
      const { deps } = loop([
        new TypeError('Failed to fetch'),
        { status: 'approved', token: 'jwt' },
      ]);
      expect(await waitForApproval(3000, deps)).toEqual({
        kind: 'approved',
        token: 'jwt',
      });
    });

    it('backs off on slow-down and returns to the interval after', async () => {
      const { deps, waits } = loop([
        { status: 'slow-down', retryAfterMs: 0 },
        { status: 'slow-down', retryAfterMs: 20_000 },
        { status: 'pending' },
        { status: 'approved', token: 'jwt' },
      ]);
      await waitForApproval(3000, deps);
      expect(waits).toEqual([3000, 6000, 20_000, 3000]);
    });

    it('stops without polling again after Cancel in the app', async () => {
      let cancelled = false;
      const { deps, polls } = loop([{ status: 'pending' }], () => cancelled);
      const done = waitForApproval(3000, {
        ...deps,
        wait: async (ms) => {
          await deps.wait(ms);
          if (polls() === 2) cancelled = true;
        },
      });
      expect(await done).toEqual({ kind: 'cancelled' });
      expect(polls()).toBe(2);
    });

    it('drops a token that arrives after Cancel', async () => {
      let cancelled = false;
      const { deps } = loop([], () => cancelled);
      const result = await waitForApproval(3000, {
        ...deps,
        poll: async () => {
          cancelled = true;
          return { status: 'approved', token: 'jwt' };
        },
      });
      expect(result).toEqual({ kind: 'cancelled' });
    });

    it('gives up after the local deadline while the server stays unreachable', async () => {
      const { deps, polls } = loop([new TypeError('Failed to fetch')]);
      expect(await waitForApproval(3000, deps)).toEqual({ kind: 'expired' });
      expect(polls()).toBe(Math.ceil(MAX_SIGN_IN_WAIT_MS / 3000));
    });
  });
});
