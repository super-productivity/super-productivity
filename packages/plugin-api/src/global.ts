// Opt-in global declaration of `PluginAPI`, for plugin code that uses the
// global the app injects instead of importing it. Reference it with
//   /// <reference types="@super-productivity/plugin-api/global" />
// Kept out of index.ts so importing the package never adds globals.
import type { PluginAPI as PluginAPIType } from './types';

declare global {
  /**
   * The API the app injects into a plugin's `plugin.js`.
   *
   * Code running inside a plugin's iframe (`index.html`) gets a filtered
   * subset: the `register*` methods and a few others are not available there.
   * See "Iframe API Surface" in the plugin development guide.
   */
  const PluginAPI: PluginAPIType;
}

export {};
