import { AutomationTriggerType, ConditionType, ActionType } from '../types';

const VALID_TRIGGER_TYPES: AutomationTriggerType[] = [
  'taskCompleted',
  'taskCreated',
  'taskUpdated',
  'timeBased',
];

const VALID_CONDITION_TYPES: ConditionType[] = [
  'titleContains',
  'titleStartsWith',
  'projectIs',
  'hasTag',
  'weekdayIs',
];

const VALID_ACTION_TYPES: ActionType[] = [
  'createTask',
  'deleteTask',
  'addTag',
  'moveToProject',
  'displaySnack',
  'displayDialog',
  'webhook',
];

export const validateRule = (rule: any): boolean => {
  if (typeof rule !== 'object' || rule === null) return false;
  if (typeof rule.name !== 'string' || !rule.name.trim()) return false;
  if (typeof rule.isEnabled !== 'boolean') return false;

  // Trigger validation
  if (!rule.trigger || typeof rule.trigger !== 'object') return false;
  if (!VALID_TRIGGER_TYPES.includes(rule.trigger.type)) return false;
  if (rule.trigger.type === 'timeBased' && typeof rule.trigger.value !== 'string') return false;

  // Conditions validation
  if (!Array.isArray(rule.conditions)) return false;
  for (const condition of rule.conditions) {
    if (typeof condition !== 'object' || condition === null) return false;
    if (!VALID_CONDITION_TYPES.includes(condition.type)) return false;
    if (typeof condition.value !== 'string') return false;
    if (condition.isRegex !== undefined && typeof condition.isRegex !== 'boolean') return false;
  }

  // Actions validation
  if (!Array.isArray(rule.actions)) return false;
  for (const action of rule.actions) {
    if (typeof action !== 'object' || action === null) return false;
    if (!VALID_ACTION_TYPES.includes(action.type)) return false;
    if (typeof action.value !== 'string') return false;
  }

  return true;
};
