import { describe, it, expect } from 'vitest';
import { validateRule } from './rule-validator';
import { AutomationRule } from '../types';

describe('validateRule', () => {
  const validRule: AutomationRule = {
    id: '123',
    name: 'Test Rule',
    isEnabled: true,
    trigger: { type: 'taskCreated' },
    conditions: [{ type: 'titleContains', value: 'test' }],
    actions: [{ type: 'displaySnack', value: 'Hello' }],
  };

  it('should validate a correct rule', () => {
    expect(validateRule(validRule)).toBe(true);
  });

  it('should validate a correct time-based rule', () => {
    const rule = {
      ...validRule,
      trigger: { type: 'timeBased', value: '10:00' },
    };
    expect(validateRule(rule)).toBe(true);
  });

  it('should fail if not an object', () => {
    expect(validateRule(null)).toBe(false);
    expect(validateRule('string')).toBe(false);
  });

  it('should fail if name is missing or invalid', () => {
    expect(validateRule({ ...validRule, name: undefined })).toBe(false);
    expect(validateRule({ ...validRule, name: '' })).toBe(false);
    expect(validateRule({ ...validRule, name: 123 })).toBe(false);
  });

  it('should fail if isEnabled is missing or invalid', () => {
    expect(validateRule({ ...validRule, isEnabled: undefined })).toBe(false);
    expect(validateRule({ ...validRule, isEnabled: 'true' })).toBe(false);
  });

  it('should fail if trigger is invalid', () => {
    expect(validateRule({ ...validRule, trigger: undefined })).toBe(false);
    expect(validateRule({ ...validRule, trigger: { type: 'invalid' } })).toBe(false);
    expect(validateRule({ ...validRule, trigger: { type: 'timeBased' } })).toBe(false); // missing value
  });

  it('should fail if conditions are invalid', () => {
    expect(validateRule({ ...validRule, conditions: undefined })).toBe(false);
    expect(validateRule({ ...validRule, conditions: 'not array' })).toBe(false);
    expect(
      validateRule({
        ...validRule,
        conditions: [{ type: 'invalid', value: 'test' }],
      }),
    ).toBe(false);
    expect(
      validateRule({
        ...validRule,
        conditions: [{ type: 'titleContains', value: 123 }],
      }),
    ).toBe(false);
    expect(
      validateRule({
        ...validRule,
        conditions: [{ type: 'titleContains', value: 'test', isRegex: 'yes' }],
      }),
    ).toBe(false);
  });

  it('should fail if actions are invalid', () => {
    expect(validateRule({ ...validRule, actions: undefined })).toBe(false);
    expect(validateRule({ ...validRule, actions: 'not array' })).toBe(false);
    expect(
      validateRule({
        ...validRule,
        actions: [{ type: 'invalid', value: 'test' }],
      }),
    ).toBe(false);
  });

  it('should validate supported advanced condition and action types', () => {
    const rule: AutomationRule = {
      ...validRule,
      conditions: [
        { type: 'titleStartsWith', value: 'Bug:' },
        { type: 'weekdayIs', value: 'Mon,Fri' },
      ],
      actions: [
        { type: 'moveToProject', value: 'project-1' },
        { type: 'deleteTask', value: '' },
      ],
    };

    expect(validateRule(rule)).toBe(true);
  });

  it('should validate regex-enabled title conditions', () => {
    const rule: AutomationRule = {
      ...validRule,
      conditions: [{ type: 'titleContains', value: '^bug', isRegex: true }],
    };

    expect(validateRule(rule)).toBe(true);
  });
});
