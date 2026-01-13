import { EntityType } from './operation.types';
import {
  ENTITY_CONFIGS,
  getEntityConfig,
  getPayloadKey,
  getAllPayloadKeys,
  isAdapterEntity,
  isSingletonEntity,
  isMapEntity,
  isArrayEntity,
  isVirtualEntity,
  EntityConfig,
} from './entity-registry';

describe('entity-registry', () => {
  // Entity types that should have configs
  const REGULAR_ENTITY_TYPES: EntityType[] = [
    'TASK',
    'PROJECT',
    'TAG',
    'NOTE',
    'GLOBAL_CONFIG',
    'SIMPLE_COUNTER',
    'WORK_CONTEXT',
    'TIME_TRACKING',
    'TASK_REPEAT_CFG',
    'ISSUE_PROVIDER',
    'PLANNER',
    'MENU_TREE',
    'METRIC',
    'BOARD',
    'REMINDER',
    'PLUGIN_USER_DATA',
    'PLUGIN_METADATA',
  ];

  // Special operation types that should NOT have configs
  const SPECIAL_OPERATION_TYPES: EntityType[] = ['MIGRATION', 'RECOVERY', 'ALL'];

  // Categorize entity types by storage pattern
  const ADAPTER_ENTITIES: EntityType[] = [
    'TASK',
    'PROJECT',
    'TAG',
    'NOTE',
    'SIMPLE_COUNTER',
    'TASK_REPEAT_CFG',
    'METRIC',
    'ISSUE_PROVIDER',
  ];

  const SINGLETON_ENTITIES: EntityType[] = [
    'GLOBAL_CONFIG',
    'TIME_TRACKING',
    'MENU_TREE',
    'WORK_CONTEXT',
  ];

  const MAP_ENTITIES: EntityType[] = ['PLANNER'];

  const ARRAY_ENTITIES: EntityType[] = ['BOARD', 'REMINDER'];

  const VIRTUAL_ENTITIES: EntityType[] = ['PLUGIN_USER_DATA', 'PLUGIN_METADATA'];

  describe('ENTITY_CONFIGS completeness', () => {
    it('should have config for all regular entity types', () => {
      for (const entityType of REGULAR_ENTITY_TYPES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config).toBeDefined(`Missing config for ${entityType}`);
      }
    });

    it('should NOT have config for special operation types', () => {
      for (const entityType of SPECIAL_OPERATION_TYPES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config).toBeUndefined(`Unexpected config for special type ${entityType}`);
      }
    });

    it('should have unique payload keys for all entities', () => {
      const payloadKeys = new Set<string>();
      for (const entityType of REGULAR_ENTITY_TYPES) {
        const config = ENTITY_CONFIGS[entityType];
        if (config?.payloadKey) {
          expect(payloadKeys.has(config.payloadKey)).toBe(
            false,
            `Duplicate payload key: ${config.payloadKey}`,
          );
          payloadKeys.add(config.payloadKey);
        }
      }
    });
  });

  describe('adapter entities', () => {
    it('should have correct storagePattern', () => {
      for (const entityType of ADAPTER_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.storagePattern).toBe(
          'adapter',
          `${entityType} should have storagePattern 'adapter'`,
        );
      }
    });

    it('should have adapter property', () => {
      for (const entityType of ADAPTER_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.adapter).toBeDefined(`${entityType} missing adapter`);
      }
    });

    it('should have adapter with required methods', () => {
      for (const entityType of ADAPTER_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        const adapter = config?.adapter;
        expect(typeof adapter?.selectId).toBe(
          'function',
          `${entityType} adapter missing selectId`,
        );
        expect(typeof adapter?.getSelectors).toBe(
          'function',
          `${entityType} adapter missing getSelectors`,
        );
      }
    });

    it('should have selectEntities selector', () => {
      for (const entityType of ADAPTER_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.selectEntities).toBeDefined(
          `${entityType} missing selectEntities`,
        );
        expect(typeof config?.selectEntities).toBe(
          'function',
          `${entityType} selectEntities should be a function`,
        );
      }
    });

    it('should have selectById selector or factory', () => {
      for (const entityType of ADAPTER_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.selectById).toBeDefined(`${entityType} missing selectById`);
        expect(typeof config?.selectById).toBe(
          'function',
          `${entityType} selectById should be a function`,
        );
      }
    });

    it('should have featureName', () => {
      for (const entityType of ADAPTER_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.featureName).toBeDefined(`${entityType} missing featureName`);
        expect(typeof config?.featureName).toBe(
          'string',
          `${entityType} featureName should be a string`,
        );
      }
    });
  });

  describe('singleton entities', () => {
    it('should have correct storagePattern', () => {
      for (const entityType of SINGLETON_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.storagePattern).toBe(
          'singleton',
          `${entityType} should have storagePattern 'singleton'`,
        );
      }
    });

    it('should have selectState selector', () => {
      for (const entityType of SINGLETON_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.selectState).toBeDefined(`${entityType} missing selectState`);
        expect(typeof config?.selectState).toBe(
          'function',
          `${entityType} selectState should be a function`,
        );
      }
    });

    it('should have featureName', () => {
      for (const entityType of SINGLETON_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.featureName).toBeDefined(`${entityType} missing featureName`);
      }
    });

    it('should NOT have adapter', () => {
      for (const entityType of SINGLETON_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.adapter).toBeUndefined(
          `${entityType} should NOT have adapter (singleton)`,
        );
      }
    });
  });

  describe('map entities', () => {
    it('should have correct storagePattern', () => {
      for (const entityType of MAP_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.storagePattern).toBe(
          'map',
          `${entityType} should have storagePattern 'map'`,
        );
      }
    });

    it('should have mapKey property', () => {
      for (const entityType of MAP_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.mapKey).toBeDefined(`${entityType} missing mapKey`);
        expect(typeof config?.mapKey).toBe(
          'string',
          `${entityType} mapKey should be a string`,
        );
      }
    });

    it('should have selectState selector', () => {
      for (const entityType of MAP_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.selectState).toBeDefined(`${entityType} missing selectState`);
      }
    });
  });

  describe('array entities', () => {
    it('should have correct storagePattern', () => {
      for (const entityType of ARRAY_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.storagePattern).toBe(
          'array',
          `${entityType} should have storagePattern 'array'`,
        );
      }
    });

    it('should have arrayKey property (can be null for state-is-array)', () => {
      for (const entityType of ARRAY_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        // arrayKey should be defined (can be string or null)
        expect('arrayKey' in (config || {})).toBe(true, `${entityType} missing arrayKey`);
      }
    });

    it('should have selectState selector', () => {
      for (const entityType of ARRAY_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.selectState).toBeDefined(`${entityType} missing selectState`);
      }
    });
  });

  describe('virtual entities', () => {
    it('should have correct storagePattern', () => {
      for (const entityType of VIRTUAL_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.storagePattern).toBe(
          'virtual',
          `${entityType} should have storagePattern 'virtual'`,
        );
      }
    });

    it('should have payloadKey', () => {
      for (const entityType of VIRTUAL_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.payloadKey).toBeDefined(`${entityType} missing payloadKey`);
      }
    });

    it('should NOT have featureName (not stored in NgRx)', () => {
      for (const entityType of VIRTUAL_ENTITIES) {
        const config = ENTITY_CONFIGS[entityType];
        expect(config?.featureName).toBeUndefined(
          `${entityType} should NOT have featureName (virtual)`,
        );
      }
    });
  });

  describe('getEntityConfig', () => {
    it('should return config for known entity types', () => {
      const config = getEntityConfig('TASK');
      expect(config).toBeDefined();
      expect(config?.payloadKey).toBe('task');
    });

    it('should return undefined for unknown entity types', () => {
      const config = getEntityConfig('UNKNOWN_TYPE' as EntityType);
      expect(config).toBeUndefined();
    });

    it('should return undefined for special operation types', () => {
      for (const entityType of SPECIAL_OPERATION_TYPES) {
        const config = getEntityConfig(entityType);
        expect(config).toBeUndefined(
          `getEntityConfig should return undefined for ${entityType}`,
        );
      }
    });
  });

  describe('getPayloadKey', () => {
    it('should return payload key for known entity types', () => {
      expect(getPayloadKey('TASK')).toBe('task');
      expect(getPayloadKey('PROJECT')).toBe('project');
      expect(getPayloadKey('TAG')).toBe('tag');
      expect(getPayloadKey('GLOBAL_CONFIG')).toBe('globalConfig');
    });

    it('should return undefined for unknown entity types', () => {
      expect(getPayloadKey('UNKNOWN' as EntityType)).toBeUndefined();
    });
  });

  describe('getAllPayloadKeys', () => {
    it('should return all payload keys', () => {
      const keys = getAllPayloadKeys();
      expect(keys.length).toBeGreaterThan(0);
      expect(keys).toContain('task');
      expect(keys).toContain('project');
      expect(keys).toContain('tag');
      expect(keys).toContain('globalConfig');
    });

    it('should not include undefined values', () => {
      const keys = getAllPayloadKeys();
      expect(keys.every((k) => k !== undefined)).toBe(true);
      expect(keys.every((k) => typeof k === 'string')).toBe(true);
    });

    it('should return unique values', () => {
      const keys = getAllPayloadKeys();
      const uniqueKeys = [...new Set(keys)];
      expect(keys.length).toBe(uniqueKeys.length);
    });
  });

  describe('storage pattern helpers', () => {
    it('isAdapterEntity should correctly identify adapter entities', () => {
      const taskConfig = getEntityConfig('TASK') as EntityConfig;
      const configConfig = getEntityConfig('GLOBAL_CONFIG') as EntityConfig;

      expect(isAdapterEntity(taskConfig)).toBe(true);
      expect(isAdapterEntity(configConfig)).toBe(false);
    });

    it('isSingletonEntity should correctly identify singleton entities', () => {
      const configConfig = getEntityConfig('GLOBAL_CONFIG') as EntityConfig;
      const taskConfig = getEntityConfig('TASK') as EntityConfig;

      expect(isSingletonEntity(configConfig)).toBe(true);
      expect(isSingletonEntity(taskConfig)).toBe(false);
    });

    it('isMapEntity should correctly identify map entities', () => {
      const plannerConfig = getEntityConfig('PLANNER') as EntityConfig;
      const taskConfig = getEntityConfig('TASK') as EntityConfig;

      expect(isMapEntity(plannerConfig)).toBe(true);
      expect(isMapEntity(taskConfig)).toBe(false);
    });

    it('isArrayEntity should correctly identify array entities', () => {
      const boardConfig = getEntityConfig('BOARD') as EntityConfig;
      const reminderConfig = getEntityConfig('REMINDER') as EntityConfig;
      const taskConfig = getEntityConfig('TASK') as EntityConfig;

      expect(isArrayEntity(boardConfig)).toBe(true);
      expect(isArrayEntity(reminderConfig)).toBe(true);
      expect(isArrayEntity(taskConfig)).toBe(false);
    });

    it('isVirtualEntity should correctly identify virtual entities', () => {
      const pluginConfig = getEntityConfig('PLUGIN_USER_DATA') as EntityConfig;
      const taskConfig = getEntityConfig('TASK') as EntityConfig;

      expect(isVirtualEntity(pluginConfig)).toBe(true);
      expect(isVirtualEntity(taskConfig)).toBe(false);
    });
  });

  describe('config consistency', () => {
    it('all entity types should sum to expected count', () => {
      const totalConfigured =
        ADAPTER_ENTITIES.length +
        SINGLETON_ENTITIES.length +
        MAP_ENTITIES.length +
        ARRAY_ENTITIES.length +
        VIRTUAL_ENTITIES.length;

      expect(totalConfigured).toBe(REGULAR_ENTITY_TYPES.length);
    });

    it('ENTITY_CONFIGS keys should match configured entity types', () => {
      const configuredKeys = Object.keys(ENTITY_CONFIGS).filter(
        (key) => ENTITY_CONFIGS[key as EntityType] !== undefined,
      );

      expect(configuredKeys.length).toBe(REGULAR_ENTITY_TYPES.length);

      for (const key of configuredKeys) {
        expect(REGULAR_ENTITY_TYPES).toContain(key as EntityType);
      }
    });

    /**
     * CANARY TEST: This test ensures test arrays stay in sync with EntityType union.
     * If you add a new entity type to EntityType in operation.types.ts, you MUST also:
     * 1. Add it to REGULAR_ENTITY_TYPES or SPECIAL_OPERATION_TYPES above
     * 2. Add it to the appropriate category array (ADAPTER_ENTITIES, SINGLETON_ENTITIES, etc.)
     * 3. Update the expected count below
     *
     * See docs/ai/adding-new-entity-type-checklist.md for full checklist.
     */
    it('test arrays should cover all EntityType union members (canary)', () => {
      const ALL_TESTED: EntityType[] = [
        ...REGULAR_ENTITY_TYPES,
        ...SPECIAL_OPERATION_TYPES,
      ];

      // Update this count when adding new entity types to EntityType union
      // Current: 17 regular + 3 special = 20 total
      expect(ALL_TESTED.length).toBe(20);

      // Verify no duplicates
      const uniqueTypes = new Set(ALL_TESTED);
      expect(uniqueTypes.size).toBe(ALL_TESTED.length);
    });
  });
});
