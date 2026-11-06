import { InjectionToken } from '@angular/core';
import type { BoardPanelComponent } from './board-panel.component';

/**
 * The board panel, for its two renderers (cards and task rows), which show
 * its state and call its actions. A token with a type-only import, so the
 * renderers don't import the panel that imports them.
 */
export const BOARD_PANEL = new InjectionToken<BoardPanelComponent>('BOARD_PANEL');
