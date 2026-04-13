import { T } from '../t.const';
import { getPluginAssetTooLargeTranslationKey } from './plugin-size-error.util';

describe('plugin size error util', () => {
  it('should use asset-specific translation keys', () => {
    expect(getPluginAssetTooLargeTranslationKey('manifest')).toBe(
      T.PLUGINS.MANIFEST_TOO_LARGE,
    );
    expect(getPluginAssetTooLargeTranslationKey('indexHtml')).toBe(
      T.PLUGINS.INDEX_HTML_TOO_LARGE,
    );
    expect(getPluginAssetTooLargeTranslationKey('icon')).toBe(T.PLUGINS.ICON_TOO_LARGE);
  });
});
