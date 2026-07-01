import { type WorkContextThemeCfg } from '../../features/work-context/work-context.model';
import { getBackgroundImageForUrl } from './global-theme.service';

describe('getBackgroundImageForUrl()', () => {
  const theme: WorkContextThemeCfg = {
    backgroundImageDark: 'dark-bg.jpg',
    backgroundImageLight: 'light-bg.jpg',
  };
  const themeWithoutBg: WorkContextThemeCfg = {
    backgroundImageDark: null,
    backgroundImageLight: null,
  };
  const globalBg = {
    dark: 'global-dark.jpg',
    light: 'global-light.jpg',
  };
  const globalBgEmpty = {
    dark: null,
    light: null,
  };

  it('does not show a work context background before initial navigation resolves (no global bg)', () => {
    expect(getBackgroundImageForUrl(theme, globalBgEmpty, false, '')).toBeNull();
  });

  it('shows the global background before initial navigation resolves if set', () => {
    expect(getBackgroundImageForUrl(theme, globalBg, false, '')).toBe('global-light.jpg');
  });

  ['/planner', '/schedule', '/boards'].forEach((url) => {
    it(`does not show the active work context background on ${url} (no global bg)`, () => {
      expect(getBackgroundImageForUrl(theme, globalBgEmpty, false, url)).toBeNull();
    });

    it(`shows the global background on ${url}`, () => {
      expect(getBackgroundImageForUrl(theme, globalBg, false, url)).toBe('global-light.jpg');
      expect(getBackgroundImageForUrl(theme, globalBg, true, url)).toBe('global-dark.jpg');
    });
  });

  ['/tag/TODAY/tasks', '/project/project-1/tasks'].forEach((url) => {
    it(`keeps the light work context background on ${url} if it has its own image`, () => {
      expect(getBackgroundImageForUrl(theme, globalBgEmpty, false, url)).toBe('light-bg.jpg');
      expect(getBackgroundImageForUrl(theme, globalBg, false, url)).toBe('light-bg.jpg');
    });

    it(`falls back to the global background on ${url} if it does not have its own image`, () => {
      expect(getBackgroundImageForUrl(themeWithoutBg, globalBg, false, url)).toBe('global-light.jpg');
      expect(getBackgroundImageForUrl(themeWithoutBg, globalBg, true, url)).toBe('global-dark.jpg');
    });
  });

  it('uses the dark work context background in dark mode', () => {
    expect(getBackgroundImageForUrl(theme, globalBgEmpty, true, '/tag/TODAY/tasks')).toBe('dark-bg.jpg');
  });
});
