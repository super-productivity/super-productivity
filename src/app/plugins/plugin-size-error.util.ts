import { T } from '../t.const';

export type PluginSizeCheckedAsset = 'manifest' | 'indexHtml' | 'icon';

export const getPluginAssetTooLargeTranslationKey = (
  asset: PluginSizeCheckedAsset,
): string => {
  switch (asset) {
    case 'manifest':
      return T.PLUGINS.MANIFEST_TOO_LARGE;
    case 'indexHtml':
      return T.PLUGINS.INDEX_HTML_TOO_LARGE;
    case 'icon':
      return T.PLUGINS.ICON_TOO_LARGE;
  }
};
