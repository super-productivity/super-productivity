import { describe, it, expect } from 'vitest';
import {
  TriggerTaskCompleted,
  TriggerTaskCreated,
  TriggerTaskStarted,
  TriggerTaskStopped,
  TriggerTaskUpdated,
  TriggerTimeBased,
} from './triggers';
import { IAutomationTrigger } from './definitions';
import { AutomationTriggerType, TaskEvent } from '../types';

describe('Triggers', () => {
  const cases: [IAutomationTrigger, AutomationTriggerType][] = [
    [TriggerTaskCompleted, 'taskCompleted'],
    [TriggerTaskCreated, 'taskCreated'],
    [TriggerTaskUpdated, 'taskUpdated'],
    [TriggerTaskStarted, 'taskStarted'],
    [TriggerTaskStopped, 'taskStopped'],
    [TriggerTimeBased, 'timeBased'],
  ];

  it.each(cases)('$1 trigger matches only its own event type', (trigger, type) => {
    expect(trigger.matches({ type } as TaskEvent)).toBe(true);

    for (const [, otherType] of cases) {
      if (otherType === type) continue;
      expect(trigger.matches({ type: otherType } as TaskEvent)).toBe(false);
    }
  });
});
