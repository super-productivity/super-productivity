import { toEntityKey, parseEntityKey } from './entity-key.util';
import { EntityType } from '../core/operation.types';

describe('entity-key utility', () => {
  describe('toEntityKey', () => {
    it('should create a key from TASK type and id', () => {
      const key = toEntityKey('TASK', 'task-123');
      expect(key).toBe('TASK:task-123');
    });

    it('should create a key from PROJECT type and id', () => {
      const key = toEntityKey('PROJECT', 'project-abc');
      expect(key).toBe('PROJECT:project-abc');
    });

    it('should create a key from TAG type and id', () => {
      const key = toEntityKey('TAG', 'tag-xyz');
      expect(key).toBe('TAG:tag-xyz');
    });

    it('should handle empty entity id', () => {
      const key = toEntityKey('TASK', '');
      expect(key).toBe('TASK:');
    });

    it('should handle entity id with special characters', () => {
      const key = toEntityKey('TASK', 'task:with:colons');
      expect(key).toBe('TASK:task:with:colons');
    });

    it('should handle UUID-style entity ids', () => {
      const key = toEntityKey('TASK', '550e8400-e29b-41d4-a716-446655440000');
      expect(key).toBe('TASK:550e8400-e29b-41d4-a716-446655440000');
    });
  });

  describe('parseEntityKey', () => {
    it('should parse TASK key correctly', () => {
      const result = parseEntityKey('TASK:task-123');
      expect(result.entityType).toBe('TASK');
      expect(result.entityId).toBe('task-123');
    });

    it('should parse PROJECT key correctly', () => {
      const result = parseEntityKey('PROJECT:project-abc');
      expect(result.entityType).toBe('PROJECT');
      expect(result.entityId).toBe('project-abc');
    });

    it('should parse TAG key correctly', () => {
      const result = parseEntityKey('TAG:tag-xyz');
      expect(result.entityType).toBe('TAG');
      expect(result.entityId).toBe('tag-xyz');
    });

    it('should handle entity id with colons', () => {
      const result = parseEntityKey('TASK:task:with:colons');
      expect(result.entityType).toBe('TASK');
      expect(result.entityId).toBe('task:with:colons');
    });

    it('should handle empty entity id', () => {
      const result = parseEntityKey('TASK:');
      expect(result.entityType).toBe('TASK');
      expect(result.entityId).toBe('');
    });

    it('should throw error for key without colon', () => {
      expect(() => parseEntityKey('TASK-123')).toThrowError(
        'Invalid entity key format: TASK-123',
      );
    });

    it('should throw error for empty key', () => {
      expect(() => parseEntityKey('')).toThrowError('Invalid entity key format: ');
    });
  });

  describe('roundtrip', () => {
    it('should roundtrip TASK key correctly', () => {
      const entityType: EntityType = 'TASK';
      const entityId = 'task-123';
      const key = toEntityKey(entityType, entityId);
      const parsed = parseEntityKey(key);

      expect(parsed.entityType).toBe(entityType);
      expect(parsed.entityId).toBe(entityId);
    });

    it('should roundtrip all entity types', () => {
      const entityTypes: EntityType[] = [
        'TASK',
        'PROJECT',
        'TAG',
        'NOTE',
        'GLOBAL_CONFIG',
        'SIMPLE_COUNTER',
        'WORK_CONTEXT',
        'TASK_REPEAT_CFG',
        'ISSUE_PROVIDER',
        'PLANNER',
        'MENU_TREE',
        'METRIC',
        'MIGRATION',
        'RECOVERY',
        'ALL',
      ];

      for (const entityType of entityTypes) {
        const entityId = `test-id-${entityType.toLowerCase()}`;
        const key = toEntityKey(entityType, entityId);
        const parsed = parseEntityKey(key);

        expect(parsed.entityType).toBe(entityType);
        expect(parsed.entityId).toBe(entityId);
      }
    });
  });
});
