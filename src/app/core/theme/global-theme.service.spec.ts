import { type WorkContextThemeCfg } from '../../features/work-context/work-context.model';
import { getBackgroundImageForUrl } from './global-theme.service';

describe('getBackgroundImageForUrl()', () => {
  const theme: WorkContextThemeCfg = {
    backgroundImageDark: 'dark-bg.jpg',
    backgroundImageLight: 'light-bg.jpg',
  };

  it('does not show a work context background before initial navigation resolves', () => {
    expect(getBackgroundImageForUrl(theme, false, '')).toBeNull();
  });

  ['/planner', '/schedule', '/boards'].forEach((url) => {
    it(`does not show the active work context background on ${url}`, () => {
      expect(getBackgroundImageForUrl(theme, false, url)).toBeNull();
    });
  });

  ['/tag/TODAY/tasks', '/project/project-1/tasks'].forEach((url) => {
    it(`keeps the light work context background on ${url}`, () => {
      expect(getBackgroundImageForUrl(theme, false, url)).toBe('light-bg.jpg');
    });
  });

  it('uses the dark work context background in dark mode', () => {
    expect(getBackgroundImageForUrl(theme, true, '/tag/TODAY/tasks')).toBe('dark-bg.jpg');
  });
});
