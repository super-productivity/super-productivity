import { ActionType, AutomationTriggerType, ConditionType } from '../types';

// Keep these arrays in sync with the unions in types.ts. They are duplicated
// here (and in core/rule-registry.ts) rather than centralized in types.ts
// because types.ts must stay type-only — otherwise vite produces a shared
// runtime chunk that breaks plugin.js (which the host evaluates with
// `new Function`, not as an ES module).
//
// The `satisfies` clause catches extra / mistyped entries. The `_AssertEq`
// helper enforces the other direction: if a union gains a new member, this
// file fails to compile until the corresponding array is updated.
type _AssertEq<T, U> = [T] extends [U] ? ([U] extends [T] ? true : never) : never;

const AUTOMATION_TRIGGER_TYPES = [
  'taskCompleted',
  'taskCreated',
  'taskUpdated',
  'taskStarted',
  'taskStopped',
  'timeBased',
] as const satisfies readonly AutomationTriggerType[];
const _exhaustiveTriggers: _AssertEq<
  AutomationTriggerType,
  (typeof AUTOMATION_TRIGGER_TYPES)[number]
> = true;

const AUTOMATION_CONDITION_TYPES = [
  'titleContains',
  'titleStartsWith',
  'projectIs',
  'hasTag',
  'weekdayIs',
] as const satisfies readonly ConditionType[];
const _exhaustiveConditions: _AssertEq<ConditionType, (typeof AUTOMATION_CONDITION_TYPES)[number]> =
  true;

const AUTOMATION_ACTION_TYPES = [
  'createTask',
  'deleteTask',
  'addTag',
  'removeTag',
  'moveToProject',
  'displaySnack',
  'displayDialog',
  'webhook',
] as const satisfies readonly ActionType[];
const _exhaustiveActions: _AssertEq<ActionType, (typeof AUTOMATION_ACTION_TYPES)[number]> = true;

export const validateRule = (rule: any): boolean => {
  if (typeof rule !== 'object' || rule === null) return false;
  // Match the load-path validator (RuleRegistry): require a string name but
  // not a non-empty one. The UI saves rules with empty names, so the import
  // path has to accept what the export path produces.
  if (typeof rule.name !== 'string') return false;
  if (typeof rule.isEnabled !== 'boolean') return false;

  // Trigger validation
  if (!rule.trigger || typeof rule.trigger !== 'object') return false;
  if (!AUTOMATION_TRIGGER_TYPES.includes(rule.trigger.type)) return false;
  if (rule.trigger.type === 'timeBased' && typeof rule.trigger.value !== 'string') return false;

  // Conditions validation
  if (!Array.isArray(rule.conditions)) return false;
  for (const condition of rule.conditions) {
    if (typeof condition !== 'object' || condition === null) return false;
    if (!AUTOMATION_CONDITION_TYPES.includes(condition.type)) return false;
    if (typeof condition.value !== 'string') return false;
    if (condition.isRegex !== undefined && typeof condition.isRegex !== 'boolean') return false;
  }

  // Actions validation
  if (!Array.isArray(rule.actions)) return false;
  for (const action of rule.actions) {
    if (typeof action !== 'object' || action === null) return false;
    if (!AUTOMATION_ACTION_TYPES.includes(action.type)) return false;
    if (typeof action.value !== 'string') return false;
  }

  return true;
};
