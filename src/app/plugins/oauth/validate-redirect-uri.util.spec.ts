import {
  validateOAuthRedirectUri,
  RedirectUriPlatform,
  WEB_OAUTH_CALLBACK_PATH,
} from './validate-redirect-uri.util';

describe('validateOAuthRedirectUri', () => {
  describe('electron platform', () => {
    const electronPlatform: RedirectUriPlatform = {
      isElectron: true,
      isNative: false,
      origin: 'http://localhost:9876',
    };

    it('should accept a valid loopback URI', () => {
      expect(() =>
        validateOAuthRedirectUri('http://127.0.0.1:8976/callback', electronPlatform),
      ).not.toThrow();
    });

    it('should accept a loopback URI at port boundary (min)', () => {
      expect(() =>
        validateOAuthRedirectUri('http://127.0.0.1:1024/callback', electronPlatform),
      ).not.toThrow();
    });

    it('should accept a loopback URI at port boundary (max)', () => {
      expect(() =>
        validateOAuthRedirectUri('http://127.0.0.1:65535/callback', electronPlatform),
      ).not.toThrow();
    });

    it('should reject port 80 (out of range)', () => {
      expect(() =>
        validateOAuthRedirectUri('http://127.0.0.1:80/cb', electronPlatform),
      ).toThrowError(/port in \[1024, 65535\]/);
    });

    it('should reject port 0 (out of range)', () => {
      expect(() =>
        validateOAuthRedirectUri('http://127.0.0.1:0/cb', electronPlatform),
      ).toThrowError(/port in \[1024, 65535\]/);
    });

    it('should reject port 65536 (invalid for URL)', () => {
      expect(() =>
        validateOAuthRedirectUri('http://127.0.0.1:65536/cb', electronPlatform),
      ).toThrowError(/Invalid OAuth redirectUri/);
    });

    it('should reject HTTPS protocol', () => {
      expect(() =>
        validateOAuthRedirectUri('https://127.0.0.1:8976/cb', electronPlatform),
      ).toThrowError(/loopback URI http:\/\/127\.0\.0\.1/);
    });

    it('should reject localhost hostname', () => {
      expect(() =>
        validateOAuthRedirectUri('http://localhost:8976/cb', electronPlatform),
      ).toThrowError(/loopback URI http:\/\/127\.0\.0\.1/);
    });

    it('should reject evil.com hostname', () => {
      expect(() =>
        validateOAuthRedirectUri('http://evil.com:8976/cb', electronPlatform),
      ).toThrowError(/loopback URI http:\/\/127\.0\.0\.1/);
    });

    it('should reject missing port', () => {
      expect(() =>
        validateOAuthRedirectUri('http://127.0.0.1/cb', electronPlatform),
      ).toThrowError(/loopback URI http:\/\/127\.0\.0\.1/);
    });

    it('should reject malformed URL', () => {
      expect(() => validateOAuthRedirectUri('not-a-url', electronPlatform)).toThrowError(
        /Invalid OAuth redirectUri/,
      );
    });
  });

  describe('native platform', () => {
    const nativePlatform: RedirectUriPlatform = {
      isElectron: false,
      isNative: true,
      origin: 'irrelevant',
    };

    it('should reject custom scheme override', () => {
      expect(() =>
        validateOAuthRedirectUri('com.super-productivity.app:/cb', nativePlatform),
      ).toThrowError(/override is not supported on native/);
    });

    it('should reject data scheme override', () => {
      expect(() =>
        validateOAuthRedirectUri('data:text/html,x', nativePlatform),
      ).toThrowError(/override is not supported on native/);
    });

    it('should reject HTTPS override', () => {
      expect(() =>
        validateOAuthRedirectUri('https://example.com/cb', nativePlatform),
      ).toThrowError(/override is not supported on native/);
    });

    it('should reject HTTP override', () => {
      expect(() =>
        validateOAuthRedirectUri('http://example.com/cb', nativePlatform),
      ).toThrowError(/override is not supported on native/);
    });

    it('should reject file scheme override', () => {
      expect(() =>
        validateOAuthRedirectUri('file:///app/callback', nativePlatform),
      ).toThrowError(/override is not supported on native/);
    });

    it('should reject javascript scheme override', () => {
      expect(() =>
        validateOAuthRedirectUri('javascript:alert(1)', nativePlatform),
      ).toThrowError(/override is not supported on native/);
    });

    it('should reject malformed URL', () => {
      expect(() => validateOAuthRedirectUri('not-a-url', nativePlatform)).toThrowError(
        /Invalid OAuth redirectUri/,
      );
    });
  });

  describe('web platform', () => {
    const webPlatform: RedirectUriPlatform = {
      isElectron: false,
      isNative: false,
      origin: 'https://app.example.com',
    };

    it('should accept a valid same-origin callback URI', () => {
      expect(() =>
        validateOAuthRedirectUri(
          'https://app.example.com/assets/oauth-callback.html',
          webPlatform,
        ),
      ).not.toThrow();
    });

    it('should accept a same-origin URI with the correct path and query params', () => {
      expect(() =>
        validateOAuthRedirectUri(
          `https://app.example.com${WEB_OAUTH_CALLBACK_PATH}?state=123`,
          webPlatform,
        ),
      ).not.toThrow();
    });

    it('should reject a same-origin URI with wrong path', () => {
      expect(() =>
        validateOAuthRedirectUri('https://app.example.com/somewhere-else', webPlatform),
      ).toThrowError(/must be.*oauth-callback\.html/);
    });

    it('should reject a different subdomain', () => {
      expect(() =>
        validateOAuthRedirectUri('https://evil.example.com/cb', webPlatform),
      ).toThrowError(/must be.*oauth-callback\.html/);
    });

    it('should reject a different domain', () => {
      expect(() =>
        validateOAuthRedirectUri('https://evil-domain.com/cb', webPlatform),
      ).toThrowError(/must be.*oauth-callback\.html/);
    });

    it('should reject a different protocol', () => {
      expect(() =>
        validateOAuthRedirectUri('http://app.example.com/cb', webPlatform),
      ).toThrowError(/must be.*oauth-callback\.html/);
    });

    it('should reject a different port', () => {
      expect(() =>
        validateOAuthRedirectUri('https://app.example.com:8080/cb', webPlatform),
      ).toThrowError(/must be.*oauth-callback\.html/);
    });

    it('should reject malformed URL', () => {
      expect(() => validateOAuthRedirectUri('not-a-url', webPlatform)).toThrowError(
        /Invalid OAuth redirectUri/,
      );
    });
  });

  describe('edge cases', () => {
    it('should reject when all platforms are false (invalid state)', () => {
      const invalidPlatform: RedirectUriPlatform = {
        isElectron: false,
        isNative: false,
        origin: 'https://app.example.com',
      };

      // Should fall through to web validation (requires exact path)
      expect(() =>
        validateOAuthRedirectUri('https://evil.com/cb', invalidPlatform),
      ).toThrowError(/must be.*oauth-callback\.html/);
    });

    it('should handle Electron being false and Native being false (web case)', () => {
      const webPlatform: RedirectUriPlatform = {
        isElectron: false,
        isNative: false,
        origin: 'https://localhost:3000',
      };

      expect(() =>
        validateOAuthRedirectUri(
          `https://localhost:3000${WEB_OAUTH_CALLBACK_PATH}`,
          webPlatform,
        ),
      ).not.toThrow();
    });

    it('should handle URL with fragment identifier', () => {
      const webPlatform: RedirectUriPlatform = {
        isElectron: false,
        isNative: false,
        origin: 'https://app.example.com',
      };

      expect(() =>
        validateOAuthRedirectUri(
          `https://app.example.com${WEB_OAUTH_CALLBACK_PATH}#section`,
          webPlatform,
        ),
      ).not.toThrow();
    });

    it('should handle URL with userinfo (with correct path)', () => {
      const webPlatform: RedirectUriPlatform = {
        isElectron: false,
        isNative: false,
        origin: 'https://app.example.com',
      };

      // origin is the same despite userinfo, and path matches
      expect(() =>
        validateOAuthRedirectUri(
          `https://user:pass@app.example.com${WEB_OAUTH_CALLBACK_PATH}`,
          webPlatform,
        ),
      ).not.toThrow();
    });
  });
});
