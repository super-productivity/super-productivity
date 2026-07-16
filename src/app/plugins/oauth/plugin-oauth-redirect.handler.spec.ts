import { TestBed } from '@angular/core/testing';
import { PluginOAuthRedirectHandler } from './plugin-oauth-redirect.handler';
import { PluginOAuthService } from './plugin-oauth.service';

describe('PluginOAuthRedirectHandler', () => {
  let serviceSpy: jasmine.SpyObj<PluginOAuthService>;
  let handler: PluginOAuthRedirectHandler;

  beforeEach(() => {
    serviceSpy = jasmine.createSpyObj<PluginOAuthService>('PluginOAuthService', [
      'handleRedirectCode',
      'handleRedirectError',
    ]);

    TestBed.configureTestingModule({
      providers: [
        PluginOAuthRedirectHandler,
        { provide: PluginOAuthService, useValue: serviceSpy },
      ],
    });

    handler = TestBed.inject(PluginOAuthRedirectHandler);
  });

  afterEach(() => {
    handler.ngOnDestroy();
  });

  it('should forward OAuth code callbacks from same-origin postMessage', () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: 'SP_OAUTH_CALLBACK',
          code: 'oauth-code',
          state: 'state-1',
        },
      }),
    );

    expect(serviceSpy.handleRedirectCode).toHaveBeenCalledWith('oauth-code', 'state-1');
    expect(serviceSpy.handleRedirectError).not.toHaveBeenCalled();
  });

  it('should forward OAuth error callbacks from same-origin postMessage', () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: 'SP_OAUTH_CALLBACK',
          error: 'access_denied',
          state: 'state-2',
        },
      }),
    );

    expect(serviceSpy.handleRedirectError).toHaveBeenCalledWith(
      'access_denied',
      'state-2',
    );
    expect(serviceSpy.handleRedirectCode).not.toHaveBeenCalled();
  });

  it('should ignore events from a different origin', () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example.com',
        data: {
          type: 'SP_OAUTH_CALLBACK',
          code: 'oauth-code',
          state: 'state-1',
        },
      }),
    );

    expect(serviceSpy.handleRedirectCode).not.toHaveBeenCalled();
    expect(serviceSpy.handleRedirectError).not.toHaveBeenCalled();
  });

  it('should ignore non-oauth message types', () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: 'OTHER_EVENT',
          code: 'oauth-code',
        },
      }),
    );

    expect(serviceSpy.handleRedirectCode).not.toHaveBeenCalled();
    expect(serviceSpy.handleRedirectError).not.toHaveBeenCalled();
  });

  it('should remove window message listener on destroy', () => {
    const removeSpy = spyOn(window, 'removeEventListener').and.callThrough();

    handler.ngOnDestroy();

    expect(removeSpy).toHaveBeenCalledWith('message', jasmine.any(Function));
  });
});
