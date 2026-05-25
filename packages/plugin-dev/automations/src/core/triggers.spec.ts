import { describe, it, expect } from 'vitest';
import {
  TriggerTaskCompleted,
  TriggerTaskCreated,
  TriggerTaskUpdated,
  TriggerTimeBased,
} from './triggers';
import { TaskEvent } from '../types';

describe('Triggers', () => {
  it('TriggerTaskCompleted should match taskCompleted event', () => {
    const event = { type: 'taskCompleted' } as TaskEvent;
    expect(TriggerTaskCompleted.matches(event)).toBe(true);
    expect(TriggerTaskCompleted.matches({ type: 'taskCreated' } as TaskEvent)).toBe(false);
  });

  it('TriggerTaskCreated should match taskCreated event', () => {
    const event = { type: 'taskCreated' } as TaskEvent;
    expect(TriggerTaskCreated.matches(event)).toBe(true);
    expect(TriggerTaskCreated.matches({ type: 'taskCompleted' } as TaskEvent)).toBe(false);
  });

  it('TriggerTaskUpdated should match taskUpdated event', () => {
    const event = { type: 'taskUpdated' } as TaskEvent;
    expect(TriggerTaskUpdated.matches(event)).toBe(true);
    expect(TriggerTaskUpdated.matches({ type: 'taskCompleted' } as TaskEvent)).toBe(false);
  });

  it('TriggerTimeBased should match timeBased event', () => {
    const event = { type: 'timeBased' } as TaskEvent;
    expect(TriggerTimeBased.matches(event)).toBe(true);
    expect(TriggerTimeBased.matches({ type: 'taskCompleted' } as TaskEvent)).toBe(false);
  });
});
