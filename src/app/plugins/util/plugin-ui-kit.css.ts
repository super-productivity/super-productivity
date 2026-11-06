import { PLUGIN_UI_KIT_COMPONENTS_CSS } from './plugin-ui-kit-components.css';
import { PLUGIN_UI_KIT_ELEMENTS_CSS } from './plugin-ui-kit-elements.css';

/**
 * UI kit for plugin iframes: element defaults plus reusable classes that make
 * plugins look like the host app. Wrapped in a cascade layer so any unlayered
 * plugin rule wins, whatever its specificity — `.my-btn` beats the kit's
 * `button:hover:not(:disabled)` without `!important`.
 * Opt out per plugin with `"uiKit": false` in the manifest.
 */
export const PLUGIN_UI_KIT_CSS = `
<style id="sp-ui-kit">
@layer sp-ui-kit {
${PLUGIN_UI_KIT_ELEMENTS_CSS}
${PLUGIN_UI_KIT_COMPONENTS_CSS}
}
</style>
`;
