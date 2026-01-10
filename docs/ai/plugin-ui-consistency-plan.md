# Plan: Plugin UI Consistency via CSS Library + Reactive Theme

## Goal

Make iframe plugin UI more consistent with the main app by:

1. Providing a shared CSS component library
2. Adding reactive theme updates when user switches dark/light mode

## Approach

CSS-only component library (minimal: 5-7 components) + reactive theme hook

---

## Part 1: Reactive Theme Updates

### Changes Required

**1. Add `THEME_CHANGE` hook**

- File: `src/app/plugins/plugin-api.model.ts`
- Add `THEME_CHANGE = 'themeChange'` to `PluginHooks` enum

**2. Emit theme change events to plugins**

- File: `src/app/plugins/plugin-bridge.service.ts`
- Subscribe to `GlobalThemeService.darkMode()` signal
- When theme changes, call all registered `themeChange` hook handlers
- Also post `THEME_UPDATE` message to all active plugin iframes with new CSS variables

**3. Add message handler in iframe for CSS variable updates**

- File: `src/app/plugins/util/plugin-iframe.util.ts`
- Add new message type `THEME_UPDATE` to handle dynamic CSS variable injection
- In `createPluginApiScript()`, add listener that updates `:root` CSS variables

**4. Update plugin API types**

- File: `packages/plugin-api/src/index.ts`
- Add `THEME_UPDATE` to `PluginIframeMessageType`
- Export `THEME_CHANGE` hook type

---

## Part 2: CSS Component Library

### Components to Include (Minimal Set)

1. **Buttons** - `.btn`, `.btn-primary`, `.btn-outline`, `.btn-icon`
2. **Cards** - `.card`, `.card-header`, `.card-content`
3. **Inputs** - `.input`, `.textarea`, `.select`
4. **Checkbox/Toggle** - `.checkbox`, `.toggle`
5. **Text utilities** - `.text-muted`, `.text-primary`, `.text-sm`
6. **Layout helpers** - `.flex`, `.gap`, `.stack` (vertical stack)
7. **Lists** - `.list`, `.list-item`

> **No prefix** - keeps classes simple. Plugins are isolated in iframes so no conflict risk.

### Implementation

**1. Create CSS library file**

- File: `src/assets/plugin-components.css`
- Define all component classes using existing CSS variables
- Match Angular Material visual style (border-radius, shadows, colors, etc.)

**2. Inject CSS library into plugin iframes**

- File: `src/app/plugins/util/plugin-iframe.util.ts`
- Modify `createPluginCssInjection()` to include the component library CSS
- Alternatively, inline the CSS directly (avoids external fetch issues in blob URLs)

**3. Document for plugin developers**

- Add documentation/examples in `packages/plugin-dev/`
- Update one example plugin to demonstrate usage

---

## Files to Modify

| File                                         | Changes                                   |
| -------------------------------------------- | ----------------------------------------- |
| `src/app/plugins/plugin-api.model.ts`        | Add `THEME_CHANGE` hook                   |
| `packages/plugin-api/src/index.ts`           | Add `THEME_UPDATE` message type           |
| `src/app/plugins/plugin-bridge.service.ts`   | Emit theme change events                  |
| `src/app/plugins/util/plugin-iframe.util.ts` | Handle `THEME_UPDATE`, inject CSS library |
| `src/assets/plugin-components.css`           | **New file** - CSS component library      |

---

## Implementation Order

1. Add `THEME_UPDATE` message type to plugin API package
2. Create `plugin-components.css` with minimal components
3. Update `createPluginCssInjection()` to inject the CSS library
4. Add `THEME_CHANGE` hook type
5. Implement theme change detection and broadcasting in `plugin-bridge.service.ts`
6. Add message handler in iframe script for updating CSS variables
7. Test with existing plugin (e.g., procrastination-buster)

---

## CSS Component Library Design

```css
/* Example structure for plugin-components.css */

/* Buttons */
.btn {
  padding: var(--s-half) var(--s);
  border-radius: 4px;
  border: 1px solid var(--extra-border-color);
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  font-family: inherit;
  font-size: inherit;
  transition: var(--transition-standard);
}

.btn:hover {
  border-color: var(--c-primary);
}

.btn-primary {
  background: var(--c-primary);
  border-color: var(--c-primary);
  color: white;
}

.btn-primary:hover {
  filter: brightness(1.1);
}

/* Cards */
.card {
  background: var(--card-bg);
  border-radius: var(--card-border-radius);
  box-shadow: var(--card-shadow);
  padding: var(--s2);
}

/* Inputs */
.input,
.textarea,
.select {
  padding: var(--s-half) var(--s);
  border-radius: 4px;
  border: 1px solid var(--extra-border-color);
  background: var(--bg);
  color: var(--text-color);
  font-family: inherit;
  font-size: inherit;
}

.input:focus,
.textarea:focus,
.select:focus {
  outline: none;
  border-color: var(--c-primary);
}

/* Text utilities */
.text-muted {
  color: var(--text-color-muted);
}
.text-primary {
  color: var(--c-primary);
}
.text-sm {
  font-size: 0.875rem;
}

/* Layout */
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--s);
}
.flex {
  display: flex;
  gap: var(--s);
}
```

---

## Notes

- CSS library is opt-in (plugins can use it or ignore it)
- Existing plugins continue to work (backward compatible)
- Theme updates happen automatically via postMessage
- Plugins can also manually listen to `THEME_CHANGE` hook for custom handling
