import { RECIPES, RecipeName } from '../core/recipes';
import { el } from './dom';

// The chips on an empty view. Each applies a ready-made view on this device:
// no model call, no API key, no wait.
const CHIP_RECIPES: RecipeName[] = [
  'kanban',
  'eisenhower',
  'today-by-project',
  'weekly-review',
  'plan-my-week',
  'time-this-week',
];

export const renderRecipeChips = (
  container: HTMLElement,
  onPick: (name: RecipeName) => void,
): void => {
  for (const name of CHIP_RECIPES) {
    const button = el('button', undefined, RECIPES[name].label);
    button.type = 'button';
    button.addEventListener('click', () => onPick(name));
    container.appendChild(button);
  }
};
