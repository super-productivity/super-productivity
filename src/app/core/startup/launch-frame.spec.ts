import { LS } from '../persistence/storage-keys.const';
import { LaunchFrames, readLaunchFrame, saveLaunchFrame } from './launch-frame';

describe('launch-frame', () => {
  let host: HTMLElement;
  let style: HTMLStyleElement;
  let storedFrames: string | null;
  let origBodyStyle: string;

  beforeEach(() => {
    storedFrames = localStorage.getItem(LS.LAUNCH_FRAME);
    localStorage.removeItem(LS.LAUNCH_FRAME);
    origBodyStyle = document.body.getAttribute('style') ?? '';
    document.body.style.backgroundColor = 'rgb(10, 20, 30)';
    document.body.style.color = 'rgb(200, 210, 220)';

    style = document.createElement('style');
    style.textContent = `
      .mobile-bottom-nav { position: fixed; left: 0; right: 0; bottom: 0; height: 44px; }
    `;
    document.head.appendChild(style);

    host = document.createElement('div');
    host.className = 'app-container';
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    style.remove();
    document.body.setAttribute('style', origBodyStyle);
    document.documentElement.dir = '';
    if (storedFrames === null) {
      localStorage.removeItem(LS.LAUNCH_FRAME);
    } else {
      localStorage.setItem(LS.LAUNCH_FRAME, storedFrames);
    }
  });

  const stored = (): LaunchFrames =>
    JSON.parse(localStorage.getItem(LS.LAUNCH_FRAME) as string);

  it('reads the theme colors of the rendered shell', () => {
    expect(readLaunchFrame(document)).toEqual(
      jasmine.objectContaining({
        bg: 'rgb(10, 20, 30)',
        fg: 'rgb(200, 210, 220)',
        bottomBar: null,
        isRtl: false,
      }),
    );
  });

  it('records RTL', () => {
    document.documentElement.dir = 'rtl';

    expect(readLaunchFrame(document)?.isRtl).toBe(true);
  });

  it('measures the bottom bar from the viewport bottom', () => {
    host.insertAdjacentHTML('beforeend', '<div class="mobile-bottom-nav"></div>');

    expect(readLaunchFrame(document)?.bottomBar).toBe(44);
  });

  it('ignores a bottom bar that is hidden', () => {
    host.insertAdjacentHTML(
      'beforeend',
      '<div class="mobile-bottom-nav" style="display: none"></div>',
    );

    expect(readLaunchFrame(document)?.bottomBar).toBeNull();
  });

  it('reads nothing while the shell is not rendered', () => {
    host.classList.remove('app-container');

    expect(readLaunchFrame(document)).toBeNull();
  });

  it('stores frames per mode, keeping the other one', () => {
    saveLaunchFrame(document, true);
    document.body.style.backgroundColor = 'rgb(250, 250, 250)';
    saveLaunchFrame(document, false);

    expect(stored().dark?.bg).toBe('rgb(10, 20, 30)');
    expect(stored().light?.bg).toBe('rgb(250, 250, 250)');
  });

  it('replaces a corrupt entry instead of throwing', () => {
    localStorage.setItem(LS.LAUNCH_FRAME, '{not json');

    expect(() => saveLaunchFrame(document, true)).not.toThrow();
    expect(stored().dark?.bg).toBe('rgb(10, 20, 30)');
  });
});
