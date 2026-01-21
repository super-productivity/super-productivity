import { TestBed } from '@angular/core/testing';
import { OAuthCallbackHandlerService } from './oauth-callback-handler.service';

describe('OAuthCallbackHandlerService', () => {
  let service: OAuthCallbackHandlerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(OAuthCallbackHandlerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('_parseOAuthCallback', () => {
    it('should extract auth code from valid URL', () => {
      const url = 'com.super-productivity.app://oauth-callback?code=ABC123';
      const result = service['_parseOAuthCallback'](url);

      expect(result.code).toBe('ABC123');
      expect(result.provider).toBe('dropbox');
      expect(result.error).toBeUndefined();
    });

    it('should extract error from callback URL', () => {
      const url =
        'com.super-productivity.app://oauth-callback?error=access_denied&error_description=User%20denied%20access';
      const result = service['_parseOAuthCallback'](url);

      expect(result.code).toBeUndefined();
      expect(result.error).toBe('access_denied');
      expect(result.error_description).toBe('User denied access');
      expect(result.provider).toBe('dropbox');
    });

    it('should handle URL without code or error', () => {
      const url = 'com.super-productivity.app://oauth-callback';
      const result = service['_parseOAuthCallback'](url);

      expect(result.code).toBeUndefined();
      expect(result.error).toBeUndefined();
      expect(result.provider).toBe('dropbox');
    });

    it('should handle malformed URL', () => {
      const url = 'not-a-valid-url';
      const result = service['_parseOAuthCallback'](url);

      expect(result.error).toBe('parse_error');
      expect(result.error_description).toBe('Failed to parse OAuth callback URL');
      expect(result.provider).toBe('dropbox');
    });

    it('should decode URL-encoded parameters', () => {
      const url =
        'com.super-productivity.app://oauth-callback?error_description=Access%20was%20denied';
      const result = service['_parseOAuthCallback'](url);

      expect(result.error_description).toBe('Access was denied');
    });
  });
});
