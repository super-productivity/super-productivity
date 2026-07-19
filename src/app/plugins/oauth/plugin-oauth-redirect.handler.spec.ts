import { TestBed } from '@angular/core/testing';
import { PluginOAuthRedirectHandler } from './plugin-oauth-redirect.handler';
import { PluginOAuthService } from './plugin-oauth.service';

describe('PluginOAuthRedirectHandler', () => {
  let serviceSpy: jasmine.SpyObj<PluginOAuthService>;

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
  });

  it('should forward same-origin OAuth code callbacks', () => {
    let messageListener: ((event: MessageEvent) => void) | undefined;
    spyOn(window, 'addEventListener').and.callFake(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'message' && typeof listener === 'function') {
          messageListener = listener as (event: MessageEvent) => void;
        }
      },
    );

    TestBed.inject(PluginOAuthRedirectHandler);
    expect(messageListener).toBeDefined();

    messageListener!(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'SP_OAUTH_CALLBACK', code: 'auth-code', state: 'oauth-state' },
      }),
    );

    expect(serviceSpy.handleRedirectCode).toHaveBeenCalledOnceWith(
      'auth-code',
      'oauth-state',
    );
    expect(serviceSpy.handleRedirectError).not.toHaveBeenCalled();
  });

  it('should forward same-origin OAuth error callbacks', () => {
    let messageListener: ((event: MessageEvent) => void) | undefined;
    spyOn(window, 'addEventListener').and.callFake(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'message' && typeof listener === 'function') {
          messageListener = listener as (event: MessageEvent) => void;
        }
      },
    );

    TestBed.inject(PluginOAuthRedirectHandler);

    messageListener!(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: 'SP_OAUTH_CALLBACK',
          error: 'access_denied',
          state: 'oauth-state',
        },
      }),
    );

    expect(serviceSpy.handleRedirectError).toHaveBeenCalledOnceWith(
      'access_denied',
      'oauth-state',
    );
    expect(serviceSpy.handleRedirectCode).not.toHaveBeenCalled();
  });

  it('should ignore callbacks from a different origin or message type', () => {
    let messageListener: ((event: MessageEvent) => void) | undefined;
    spyOn(window, 'addEventListener').and.callFake(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'message' && typeof listener === 'function') {
          messageListener = listener as (event: MessageEvent) => void;
        }
      },
    );

    TestBed.inject(PluginOAuthRedirectHandler);

    messageListener!(
      new MessageEvent('message', {
        origin: 'https://evil.example.com',
        data: { type: 'SP_OAUTH_CALLBACK', code: 'ignored' },
      }),
    );
    messageListener!(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'OTHER_EVENT', code: 'ignored' },
      }),
    );

    expect(serviceSpy.handleRedirectCode).not.toHaveBeenCalled();
    expect(serviceSpy.handleRedirectError).not.toHaveBeenCalled();
  });

  it('should remove the registered message listener on destroy', () => {
    let messageListener: ((event: MessageEvent) => void) | undefined;
    spyOn(window, 'addEventListener').and.callFake(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'message' && typeof listener === 'function') {
          messageListener = listener as (event: MessageEvent) => void;
        }
      },
    );
    const removeEventListenerSpy = spyOn(window, 'removeEventListener');

    const handler = TestBed.inject(PluginOAuthRedirectHandler);
    handler.ngOnDestroy();

    expect(removeEventListenerSpy).toHaveBeenCalledOnceWith('message', messageListener!);
  });
});
