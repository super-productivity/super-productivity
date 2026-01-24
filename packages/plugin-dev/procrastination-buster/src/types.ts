// ============================================================================
// Constants and Enums
// ============================================================================

/**
 * Plugin message types sent from the iframe to the plugin.
 */
export enum PluginMessageType {
  START_POMODORO = 'START_POMODORO',
  START_FOCUS_MODE = 'START_FOCUS_MODE',
}

/**
 * Window message types for iframe communication.
 */
export enum WindowMessageType {
  PLUGIN_MESSAGE = 'PLUGIN_MESSAGE',
}

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Represents a strategy with optional action
 */
export interface Strategy {
  text: string;
  action?: boolean; // true if this strategy can trigger a focus session
}

/**
 * Represents a type of procrastination with associated strategies.
 */
export interface ProcrastinationType {
  id: string;
  title: string;
  emotion: string;
  strategies: (string | Strategy)[];
}

// ============================================================================
// Data
// ============================================================================

/**
 * Type IDs for procrastination types - used to load translations
 */
export const PROCRASTINATION_TYPE_IDS = [
  'overwhelm',
  'perfectionism',
  'unclear',
  'boring',
  'fear',
  'energy',
  'distraction',
  'resistance',
] as const;

export type ProcrastinationTypeId = (typeof PROCRASTINATION_TYPE_IDS)[number];

/**
 * Creates procrastination types from translation function
 * This allows the types to be translated dynamically
 */
export async function getProcrastinationTypes(
  t: (key: string, params?: Record<string, string | number>) => Promise<string>,
): Promise<ProcrastinationType[]> {
  const types: ProcrastinationType[] = [];

  for (const id of PROCRASTINATION_TYPE_IDS) {
    const typeKey = id.toUpperCase();

    // Load all 4 strategies for this type
    const strategies: (string | Strategy)[] = [];
    for (let i = 1; i <= 4; i++) {
      const strategyText = await t(`TYPES.${typeKey}.STRATEGY_${i}`);

      // Special cases with actions
      if ((id === 'overwhelm' && i === 4) || (id === 'distraction' && i === 2)) {
        strategies.push({ text: strategyText, action: true });
      } else {
        strategies.push(strategyText);
      }
    }

    types.push({
      id,
      title: await t(`TYPES.${typeKey}.TITLE`),
      emotion: await t(`TYPES.${typeKey}.EMOTION`),
      strategies,
    });
  }

  return types;
}

/**
 * Available procrastination types with their strategies.
 * Each type represents a common reason for procrastination.
 *
 * @deprecated Use getProcrastinationTypes() instead for i18n support
 */
export const procrastinationTypes: ProcrastinationType[] = [
  {
    id: 'overwhelm',
    title: 'Overwhelm',
    emotion: 'Too much at once',
    strategies: [
      'Create micro-tasks (5 min steps)',
      'Implementation Intentions (If X, then Y)',
      'Pick just one thing',
      { text: 'Start Focus Session', action: true },
    ],
  },
  {
    id: 'perfectionism',
    title: 'Perfectionism',
    emotion: "It's not perfect enough",
    strategies: [
      'Time-box your first draft (30 min)',
      'Journal: What is "good enough"?',
      'Practice self-compassion',
      'Progress over perfection',
    ],
  },
  {
    id: 'unclear',
    title: 'Unclear',
    emotion: "I don't know what to do",
    strategies: [
      'Define next concrete step',
      'Talk to someone about it',
      'Create a mind map',
      'Write down questions',
    ],
  },
  {
    id: 'boring',
    title: 'Boredom',
    emotion: "It's boring",
    strategies: [
      'Add gamification',
      'Combine with music/podcast',
      'Plan a reward',
      'Break into smaller parts',
    ],
  },
  {
    id: 'fear',
    title: 'Fear',
    emotion: 'I might fail',
    strategies: [
      'Think through worst case',
      'Run small experiments',
      'Activate support system',
      'Document successes',
    ],
  },
  {
    id: 'energy',
    title: 'Low Energy',
    emotion: "I'm too tired",
    strategies: [
      '5-minute movement break',
      'Drink water',
      'Easiest task first',
      'Power nap (20 min)',
    ],
  },
  {
    id: 'distraction',
    title: 'Distraction',
    emotion: 'Other things are more interesting',
    strategies: [
      'Block distractions',
      { text: 'Schedule deep work block', action: true },
      'Clear work environment',
      'Start focus ritual',
    ],
  },
  {
    id: 'resistance',
    title: 'Resistance',
    emotion: "I don't want to do this",
    strategies: [
      'Why is it important?',
      'Pair with something pleasant',
      'Consider delegating',
      'Reframe: What will I learn?',
    ],
  },
];
