import { LS } from '../persistence/storage-keys.const';
import { LaunchFrames, readLaunchFrame, saveLaunchFrame } from './launch-frame';

describe('launch-frame', () => {
  let iframe: HTMLIFrameElement;
  let doc: Document;
  let host: HTMLElement;
  let storedFrames: string | null;

  beforeEach(() => {
    storedFrames = localStorage.getItem(LS.LAUNCH_FRAME);
    localStorage.removeItem(LS.LAUNCH_FRAME);
    // Other suites retain fixtures in the runner document. Use a real, isolated
    // browsing context so selectors, theme styles and viewport measurements agree.
    iframe = document.createElement('iframe');
    iframe.height = '600';
    document.body.appendChild(iframe);
    doc = iframe.contentDocument!;
    doc.body.style.backgroundColor = 'rgb(10, 20, 30)';
    doc.body.style.color = 'rgb(200, 210, 220)';

    const style = doc.createElement('style');
    style.textContent = `
      .mobile-bottom-nav { position: fixed; left: 0; right: 0; bottom: 0; height: 44px; }
    `;
    doc.head.appendChild(style);

    host = doc.createElement('div');
    host.className = 'app-container';
    doc.body.appendChild(host);
  });

  afterEach(() => {
    iframe.remove();
    if (storedFrames === null) {
      localStorage.removeItem(LS.LAUNCH_FRAME);
    } else {
      localStorage.setItem(LS.LAUNCH_FRAME, storedFrames);
    }
  });

  const stored = (): LaunchFrames =>
    JSON.parse(localStorage.getItem(LS.LAUNCH_FRAME) as string);

  it('reads the theme colors of the rendered shell', () => {
    expect(readLaunchFrame(doc)).toEqual(
      jasmine.objectContaining({
        bg: 'rgb(10, 20, 30)',
        fg: 'rgb(200, 210, 220)',
        bottomBar: null,
        isRtl: false,
      }),
    );
  });

  it('records RTL', () => {
    doc.documentElement.dir = 'rtl';

    expect(readLaunchFrame(doc)?.isRtl).toBe(true);
  });

  it('measures the bottom bar from the viewport bottom', () => {
    host.insertAdjacentHTML('beforeend', '<div class="mobile-bottom-nav"></div>');

    expect(readLaunchFrame(doc)?.bottomBar).toBe(44);
  });

  it('ignores a bottom bar that is hidden', () => {
    host.insertAdjacentHTML(
      'beforeend',
      '<div class="mobile-bottom-nav" style="display: none"></div>',
    );

    expect(readLaunchFrame(doc)?.bottomBar).toBeNull();
  });

  it('ignores a shell and bottom bar in the runner document', () => {
    const foreignHost = document.createElement('div');
    foreignHost.className = 'app-container';
    foreignHost.innerHTML =
      '<div class="mobile-bottom-nav" style="position: fixed; bottom: 0; height: 44px"></div>';
    document.body.appendChild(foreignHost);

    try {
      expect(readLaunchFrame(doc)?.bottomBar).toBeNull();
      host.classList.remove('app-container');
      expect(readLaunchFrame(doc)).toBeNull();
    } finally {
      foreignHost.remove();
    }
  });

  it('reads nothing while the shell is not rendered', () => {
    host.classList.remove('app-container');

    expect(readLaunchFrame(doc)).toBeNull();
  });

  it('stores frames per mode, keeping the other one', () => {
    saveLaunchFrame(doc, true);
    doc.body.style.backgroundColor = 'rgb(250, 250, 250)';
    saveLaunchFrame(doc, false);

    expect(stored().dark?.bg).toBe('rgb(10, 20, 30)');
    expect(stored().light?.bg).toBe('rgb(250, 250, 250)');
  });

  it('replaces a corrupt entry instead of throwing', () => {
    localStorage.setItem(LS.LAUNCH_FRAME, '{not json');

    expect(() => saveLaunchFrame(doc, true)).not.toThrow();
    expect(stored().dark?.bg).toBe('rgb(10, 20, 30)');
  });
});
