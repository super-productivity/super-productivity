import { Task } from '@super-productivity/plugin-api';

export type AutomationTriggerType = 'taskCompleted' | 'taskCreated' | 'taskUpdated' | 'timeBased';

export interface AutomationTrigger {
  type: AutomationTriggerType;
  value?: string; // For timeBased: "HH:MM" (24h format)
}

export interface TaskEvent {
  type: AutomationTriggerType;
  task?: Task;
  previousTaskState?: unknown; // only used for "updated"
  changes?: Record<string, unknown>;
}

export type ConditionType =
  | 'titleContains'
  | 'titleStartsWith'
  | 'projectIs'
  | 'hasTag'
  | 'weekdayIs';

export interface Condition {
  type: ConditionType;
  value: string;
  isRegex?: boolean;
}

export type ActionType =
  | 'createTask'
  | 'deleteTask'
  | 'addTag'
  | 'moveToProject'
  | 'displaySnack'
  | 'displayDialog'
  | 'webhook';

export interface Action {
  type: ActionType;
  value: string; // For createTask: title; For addTag/moveToProject: tag/project identifier; For deleteTask: unused
}

export interface AutomationRule {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: Condition[];
  actions: Action[];
  isEnabled: boolean;
}
