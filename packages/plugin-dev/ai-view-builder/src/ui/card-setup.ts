import type { Task } from '@super-productivity/plugin-api';
import type { ModelEnv } from '../core/cards';
import { createAddInputs, wireAddInputs, type AddInputs } from './add-inputs';
import { createCardActions } from './card-actions';
import { createCardController } from './card-controller';
import { wireCardEvents, type CardEvents } from './card-events';
import { createRenderGate, type RenderGate } from './render-gate';

// Builds the pieces that make the cards work and joins them to the app: the
// writes, the gestures, the delegated events and the redraw gate.

export interface SetupDeps {
  root: HTMLElement;
  canTrack: boolean;
  env(): ModelEnv | null;
  patch(id: string, changes: Partial<Task>): void;
  setCurrent(taskId: string | null): void;
  setSelected(taskId: string): void;
  render(animate: boolean, force?: boolean): void;
  run(write: () => Promise<unknown>): Promise<void>;
}

export interface CardSetup {
  adds: AddInputs;
  /** Task ids whose sub-tasks are folded; local to the view, never written. */
  collapsed: Set<string>;
  gate: RenderGate;
  events: CardEvents;
}

export const setupCards = (deps: SetupDeps): CardSetup => {
  const { root, canTrack } = deps;
  const adds = createAddInputs();
  const collapsed = new Set<string>();
  const redraw = (): void => deps.render(false, true);
  const gate = createRenderGate(root, redraw);
  const actions = createCardActions({
    env: deps.env,
    patch: deps.patch,
    setCurrent: deps.setCurrent,
    setSelected: deps.setSelected,
    repaint: () => deps.render(true),
    run: deps.run,
    canTrack,
  });
  const controller = createCardController({
    root,
    actions,
    adds,
    collapsed,
    env: deps.env,
    canTrack,
    redraw,
    editorEnded: gate.released,
  });
  wireAddInputs(root, adds, {
    onAdd: (key, text) => {
      if (key.startsWith('sub:')) actions.addSubTask(key.slice('sub:'.length), text);
    },
  });
  return {
    adds,
    collapsed,
    gate,
    events: wireCardEvents({ root, controller, actions, canTrack }),
  };
};
