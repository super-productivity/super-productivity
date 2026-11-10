import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { PlainspaceAuthApiService } from './plainspace-auth-api.service';
import { Log } from '../../core/log';

// The wire shapes below are Plainspace's (routes/public-auth.ts, projects.ts,
// api-tokens.ts).
describe('PlainspaceAuthApiService', () => {
  let service: PlainspaceAuthApiService;
  let httpMock: HttpTestingController;
  const HOST = 'https://plainspace.org';
  const API = `${HOST}/api`;
  const EMAIL = 'me@example.com';

  const fail = (
    status: number,
    body: string | object = { error: 'x' },
  ): { body: string | object; opts: { status: number; statusText: string } } => ({
    body,
    opts: { status, statusText: 'Error' },
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PlainspaceAuthApiService],
    });
    service = TestBed.inject(PlainspaceAuthApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('requestCode$', () => {
    const request = (
      flush: (req: ReturnType<HttpTestingController['expectOne']>) => void,
      host = HOST,
    ): Promise<unknown> => {
      const p = firstValueFrom(service.requestCode$(host, EMAIL));
      const req = httpMock.expectOne(`${API}/auth/request-creation-code`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: EMAIL });
      flush(req);
      return p;
    };

    it('reports a sent code', async () => {
      expect(
        await request((r) => r.flush({ message: 'Verification code sent' })),
      ).toEqual({ status: 'sent' });
    });

    it('strips a trailing slash from the host', async () => {
      expect(await request((r) => r.flush({}), `${HOST}/`)).toEqual({ status: 'sent' });
    });

    it('reads a 404 as a host without email-code connect', async () => {
      const { body, opts } = fail(404, 'Not Found');
      expect(await request((r) => r.flush(body, opts))).toEqual({
        status: 'unsupported',
      });
    });

    it('maps 422, 429, 0 and 500', async () => {
      const cases: [number, string][] = [
        [422, 'invalid-email'],
        [429, 'rate-limited'],
        [500, 'unreachable'],
      ];
      for (const [status, expected] of cases) {
        const { body, opts } = fail(status);
        expect(await request((r) => r.flush(body, opts))).toEqual({ status: expected });
      }
      expect(await request((r) => r.error(new ProgressEvent('error')))).toEqual({
        status: 'unreachable',
      });
    });

    // Rule 9: the log carries the status, never the email.
    it('logs only the status', async () => {
      const logSpy = spyOn(Log, 'err');
      const { body, opts } = fail(429);
      await request((r) => r.flush(body, opts));
      expect(JSON.stringify(logSpy.calls.allArgs())).not.toContain(EMAIL);
      expect(logSpy).toHaveBeenCalledWith(jasmine.any(String), { status: 429 });
    });
  });

  describe('connect$', () => {
    const connect = (
      flush: (req: ReturnType<HttpTestingController['expectOne']>) => void,
      force = false,
    ): Promise<unknown> => {
      const p = firstValueFrom(service.connect$(HOST, EMAIL, '123456', force));
      const req = httpMock.expectOne(`${API}/auth/connect`);
      expect(req.request.body).toEqual({
        email: EMAIL,
        code: '123456',
        ...(force ? { force: true } : {}),
      });
      flush(req);
      return p;
    };

    it('returns the key of a connected account', async () => {
      expect(
        await connect((r) =>
          r.flush({
            status: 'connected',
            token: 'pat_new',
            email: EMAIL,
            witness: { slug: 's', memberToken: 'm', memberId: 'i', projectName: 'P' },
          }),
        ),
      ).toEqual({ status: 'connected', token: 'pat_new' });
    });

    it('sends force when replacing the active key', async () => {
      expect(
        await connect((r) => r.flush({ status: 'connected', token: 'pat_new' }), true),
      ).toEqual({ status: 'connected', token: 'pat_new' });
    });

    it('reports an active key elsewhere with its dates', async () => {
      expect(
        await connect((r) =>
          r.flush({
            status: 'already-connected',
            apiToken: {
              id: 't',
              createdAt: '2026-10-01T00:00:00.000Z',
              lastUsedAt: null,
              expiresAt: '2027-10-01T00:00:00.000Z',
            },
            email: EMAIL,
          }),
        ),
      ).toEqual({
        status: 'already-connected',
        createdAt: '2026-10-01T00:00:00.000Z',
        lastUsedAt: null,
      });
    });

    it('reads no-account only from its discriminator', async () => {
      const noAccount = fail(404, { code: 'no-account', error: 'No account' });
      expect(await connect((r) => r.flush(noAccount.body, noAccount.opts))).toEqual({
        status: 'no-account',
      });
      // A bare 404 must never lead to creating a duplicate Space.
      const bare = fail(404, { error: 'Not found' });
      expect(await connect((r) => r.flush(bare.body, bare.opts))).toEqual({
        status: 'failed',
      });
    });

    it('maps a 401 to a wrong or expired code, and a 429', async () => {
      const wrong = fail(401);
      expect(await connect((r) => r.flush(wrong.body, wrong.opts))).toEqual({
        status: 'invalid-code',
      });
      const tooMany = fail(429);
      expect(await connect((r) => r.flush(tooMany.body, tooMany.opts))).toEqual({
        status: 'rate-limited',
      });
    });

    it('does not take an answer without a key for connected', async () => {
      spyOn(Log, 'err');
      expect(await connect((r) => r.flush({ status: 'connected' }))).toEqual({
        status: 'unreachable',
      });
    });
  });

  describe('createSpace$ and createApiToken$', () => {
    const data = { name: 'Garden', displayName: 'Ann', email: EMAIL, code: '123456' };

    it('creates the Space and mints the key with its member session', async () => {
      const p = firstValueFrom(service.createSpace$(HOST, data));
      const req = httpMock.expectOne(`${API}/projects`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush(
        {
          project: { id: 'p-1', slug: 'garden-slug', name: 'Garden' },
          member: { id: 'm-1' },
          token: 'member_tok',
        },
        { status: 201, statusText: 'Created' },
      );
      const res = await p;
      expect(res).toEqual({
        status: 'created',
        space: { id: 'p-1', slug: 'garden-slug', memberToken: 'member_tok' },
      });

      const space = { id: 'p-1', slug: 'garden-slug', memberToken: 'member_tok' };
      const tokenP = firstValueFrom(service.createApiToken$(HOST, space));
      const tokenReq = httpMock.expectOne(`${API}/projects/garden-slug/auth/api-tokens`);
      expect(tokenReq.request.method).toBe('POST');
      expect(tokenReq.request.headers.get('Authorization')).toBe('Bearer member_tok');
      tokenReq.flush({ token: 'pat_new', apiToken: { id: 't' } });
      expect(await tokenP).toBe('pat_new');
    });

    it('maps a wrong code and a refusal', async () => {
      const p = firstValueFrom(service.createSpace$(HOST, data));
      httpMock
        .expectOne(`${API}/projects`)
        .flush({ error: 'Invalid' }, { status: 401, statusText: 'Unauthorized' });
      expect(await p).toEqual({ status: 'invalid-code' });

      const p2 = firstValueFrom(service.createSpace$(HOST, data));
      httpMock
        .expectOne(`${API}/projects`)
        .flush({ error: 'Validation failed' }, { status: 422, statusText: 'Invalid' });
      expect(await p2).toEqual({ status: 'failed' });
    });

    it('returns null when the key cannot be minted', async () => {
      const space = { id: 'p-1', slug: 's', memberToken: 'm' };
      const p = firstValueFrom(service.createApiToken$(HOST, space));
      httpMock
        .expectOne(`${API}/projects/s/auth/api-tokens`)
        .flush({ error: 'x' }, { status: 400, statusText: 'Bad' });
      expect(await p).toBeNull();
    });
  });
});
