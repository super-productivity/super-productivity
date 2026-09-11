import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { OAuthCallbackHandlerService } from './oauth-callback-handler.service';
import {
  PENDING_CAPACITOR_OAUTH_URL,
  pendingCapacitorOAuthUrl$,
} from './pending-capacitor-oauth-url';
import { OAuthCallbackData } from './oauth-callback-handler.service';

describe('OAuthCallbackHandlerService', () => {
  let service: OAuthCallbackHandlerService;
  let pendingUrl$: Subject<string>;

  beforeEach(() => {
    pendingUrl$ = new Subject<string>();
    TestBed.configureTestingModule({
      providers: [{ provide: PENDING_CAPACITOR_OAUTH_URL, useValue: pendingUrl$ }],
    });
    service = TestBed.inject(OAuthCallbackHandlerService);
  });

  describe('routed URL', () => {
    // Capacitor hands a launch URL to the first `appUrlOpen` listener only and
    // then discards it, so this service can no longer register its own — it
    // consumes URLs routed from the single listener in main.ts.
    //
    // `_setupAppUrlListener` is invoked directly because IS_NATIVE_PLATFORM is
    // false under Karma, and it is invoked BEFORE the consumer subscribes
    // because that is production's order: the constructor runs inside an
    // APP_INITIALIZER, long before anything reads `authCodeReceived$`. Setting
    // up after subscribing would let a replayed emission look delivered when
    // production would drop it.
    it('should deliver an OAuth callback routed after setup', () => {
      service['_setupAppUrlListener']();

      const received: OAuthCallbackData[] = [];
      service.authCodeReceived$.subscribe((d) => received.push(d));
      pendingUrl$.next('com.super-productivity.app://oauth-callback?code=ABC123');

      expect(received.length).toBe(1);
      expect(received[0].code).toBe('ABC123');
    });

    it('should handle the superproductivity:// callback scheme too', () => {
      service['_setupAppUrlListener']();

      const received: OAuthCallbackData[] = [];
      service.authCodeReceived$.subscribe((d) => received.push(d));
      pendingUrl$.next('superproductivity://oauth-callback?code=ABC456');

      expect(received[0].code).toBe('ABC456');
    });

    it('should ignore a routed URL that is not an OAuth callback', () => {
      service['_setupAppUrlListener']();

      let received = false;
      service.authCodeReceived$.subscribe(() => (received = true));
      pendingUrl$.next('superproductivity://create-task/hello');

      expect(received).toBe(false);
    });

    // Asserts the real app-wide sink, not the injected test double: a
    // ReplaySubject here would hold an auth code in memory for the rest of the
    // process to replay a callback that cannot be completed anyway.
    it('should not retain a routed URL for a later subscriber', () => {
      pendingCapacitorOAuthUrl$.next(
        'com.super-productivity.app://oauth-callback?code=NOT_RETAINED',
      );

      const received: string[] = [];
      pendingCapacitorOAuthUrl$.subscribe((u) => received.push(u));

      expect(received).toEqual([]);
    });
  });

  describe('_parseOAuthCallback', () => {
    it('should extract auth code from valid URL', () => {
      const url = 'com.super-productivity.app://oauth-callback?code=ABC123';
      const result = service['_parseOAuthCallback'](url);

      expect(result.code).toBe('ABC123');
      expect(result.provider).toBe('unknown');
      expect(result.error).toBeUndefined();
    });

    it('should extract error from callback URL', () => {
      const url =
        'com.super-productivity.app://oauth-callback?error=access_denied&error_description=User%20denied%20access';
      const result = service['_parseOAuthCallback'](url);

      expect(result.code).toBeUndefined();
      expect(result.error).toBe('access_denied');
      expect(result.error_description).toBe('User denied access');
      expect(result.provider).toBe('unknown');
    });

    it('should handle URL without code or error', () => {
      const url = 'com.super-productivity.app://oauth-callback';
      const result = service['_parseOAuthCallback'](url);

      expect(result.code).toBeUndefined();
      expect(result.error).toBeUndefined();
      expect(result.provider).toBe('unknown');
    });

    it('should handle malformed URL', () => {
      const url = 'not-a-valid-url';
      const result = service['_parseOAuthCallback'](url);

      expect(result.error).toBe('parse_error');
      expect(result.error_description).toBe('Failed to parse OAuth callback URL');
      expect(result.provider).toBe('unknown');
    });

    it('should decode URL-encoded parameters', () => {
      const url =
        'com.super-productivity.app://oauth-callback?error_description=Access%20was%20denied';
      const result = service['_parseOAuthCallback'](url);

      expect(result.error_description).toBe('Access was denied');
    });
  });
});
