import { signal } from '@angular/core';

// Live OS "reduce motion" preference. Read by every animation kill-switch
// (app.component's `@.disabled`, MATERIAL_ANIMATIONS, the body CSS catch-all
// and confetti) so the app follows the system setting without the user having
// to flip the in-app toggle too.
const mediaQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
const _prefersReducedMotion = signal(!!mediaQuery?.matches);

mediaQuery?.addEventListener('change', (ev) => _prefersReducedMotion.set(ev.matches));

export const prefersReducedMotion = _prefersReducedMotion.asReadonly();
