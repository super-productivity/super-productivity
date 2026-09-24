import { openExternalUrlForPlugin } from './plugin-open-external-url.util';

describe('openExternalUrlForPlugin', () => {
  const PERMS = ['openExternalUrl'];
  let openSpy: jasmine.Spy;
  let eaOpenSpy: jasmine.Spy;
  let originalEa: typeof window.ea;

  beforeEach(() => {
    openSpy = spyOn(window, 'open');
    eaOpenSpy = jasmine.createSpy('openExternalUrl');
    originalEa = window.ea;
    (window as unknown as { ea: Partial<typeof window.ea> }).ea = {
      openExternalUrl: eaOpenSpy,
    };
  });

  afterEach(() => {
    (window as unknown as { ea: typeof window.ea }).ea = originalEa;
  });

  const expectNothingOpened = (): void => {
    expect(openSpy).not.toHaveBeenCalled();
    expect(eaOpenSpy).not.toHaveBeenCalled();
  };

  describe('permission (fail-closed)', () => {
    [undefined, [], ['http', 'nodeExecution']].forEach((permissions) => {
      it(`rejects when permissions are ${JSON.stringify(permissions)}`, async () => {
        await expectAsync(
          openExternalUrlForPlugin('https://example.com', permissions, true),
        ).toBeRejectedWithError(/"openExternalUrl" permission/);
        expectNothingOpened();
      });
    });
  });

  describe('URL policy', () => {
    [
      'file:///home/user/notes.txt',
      'FILE:///C:/Windows/System32/calc.exe',
      '  file:///tmp/x  ',
      'ms-msdt:/id PCWDiagnostic',
      'search-ms:query=x',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'not a url',
      '',
    ].forEach((url) => {
      it(`rejects ${JSON.stringify(url)} even with the permission`, async () => {
        await expectAsync(
          openExternalUrlForPlugin(url, PERMS, true),
        ).toBeRejectedWithError(/scheme is not allowed/);
        expectNothingOpened();
      });
    });

    it('rejects a non-string URL', async () => {
      await expectAsync(
        openExternalUrlForPlugin({ href: 'https://x' }, PERMS, true),
      ).toBeRejectedWithError(/scheme is not allowed/);
      expectNothingOpened();
    });
  });

  describe('opening', () => {
    it('uses the Electron IPC on desktop', async () => {
      await openExternalUrlForPlugin(
        ' parallelcode://new-task?spTaskId=abc ',
        PERMS,
        true,
      );

      expect(eaOpenSpy).toHaveBeenCalledOnceWith('parallelcode://new-task?spTaskId=abc');
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('opens a new window without opener on web', async () => {
      await openExternalUrlForPlugin('https://example.com/a', PERMS, false);

      expect(openSpy).toHaveBeenCalledOnceWith(
        'https://example.com/a',
        '_blank',
        'noopener,noreferrer',
      );
      expect(eaOpenSpy).not.toHaveBeenCalled();
    });
  });
});
