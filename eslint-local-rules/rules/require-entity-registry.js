/**
 * ESLint rule: require-entity-registry
 *
 * Validates that entity types are properly registered in ENTITY_CONFIGS.
 *
 * ## What This Rule Checks
 *
 * 1. When ENTITY_CONFIGS object is defined, verifies expected entity types are present
 * 2. Detects unknown entity type strings (typos)
 *
 * ## Why This Matters
 *
 * The operation log system requires entity configuration in ENTITY_CONFIGS.
 * Missing configurations cause silent failures during sync, LWW resolution,
 * and dependency checking.
 *
 * ## Usage
 *
 * Add to .eslintrc.json:
 *   "local-rules/require-entity-registry": "warn"
 */

// All valid entity types from operation.types.ts
// Keep in sync with EntityType union
const VALID_ENTITY_TYPES = new Set([
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
  'MIGRATION',
  'RECOVERY',
  'ALL',
]);

// Entity types that MUST be configured in ENTITY_CONFIGS
// Excludes special types: ALL, RECOVERY, MIGRATION (not stored in NgRx)
const REQUIRED_ENTITY_TYPES = new Set([
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
]);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Validate entity types are registered in ENTITY_CONFIGS',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      missingEntityType:
        'ENTITY_CONFIGS is missing entity type "{{entityType}}". ' +
        'Add configuration for this entity type to ensure proper sync behavior.',
      unknownEntityType:
        'Unknown entity type "{{entityType}}" in {{context}}. ' +
        'Valid types: TASK, PROJECT, TAG, NOTE, etc. Check for typos.',
    },
    schema: [],
  },

  create(context) {
    /**
     * Get the variable name from a VariableDeclarator
     */
    const getVariableName = (node) => {
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
        return node.id.name;
      }
      return null;
    };

    /**
     * Extract keys from an object expression that look like entity types
     */
    const extractEntityTypeKeys = (objectExpr) => {
      const keys = new Set();
      if (objectExpr.type !== 'ObjectExpression') return keys;

      for (const prop of objectExpr.properties) {
        if (prop.type === 'Property' || prop.type === 'PropertyDefinition') {
          const key = prop.key;
          if (key.type === 'Identifier') {
            keys.add(key.name);
          } else if (key.type === 'Literal' && typeof key.value === 'string') {
            keys.add(key.value);
          }
        }
      }
      return keys;
    };

    /**
     * Check if a set of keys looks like an entity registry
     * (has at least 3 valid entity type keys)
     */
    const looksLikeEntityRegistry = (keys) => {
      let validCount = 0;
      for (const key of keys) {
        if (VALID_ENTITY_TYPES.has(key)) {
          validCount++;
        }
      }
      return validCount >= 3;
    };

    return {
      // Check ENTITY_CONFIGS definition
      VariableDeclarator(node) {
        const name = getVariableName(node);
        if (name !== 'ENTITY_CONFIGS') return;

        const init = node.init;
        if (!init || init.type !== 'ObjectExpression') return;

        const presentKeys = extractEntityTypeKeys(init);

        // Check for missing required types
        for (const entityType of REQUIRED_ENTITY_TYPES) {
          if (!presentKeys.has(entityType)) {
            context.report({
              node: init,
              messageId: 'missingEntityType',
              data: { entityType },
            });
          }
        }

        // Check for unknown types (typos)
        for (const key of presentKeys) {
          if (!VALID_ENTITY_TYPES.has(key)) {
            context.report({
              node: init,
              messageId: 'unknownEntityType',
              data: { entityType: key, context: 'ENTITY_CONFIGS' },
            });
          }
        }
      },

      // Check entityType property assignments for typos
      Property(node) {
        // Only check if key is 'entityType'
        if (node.key.type !== 'Identifier' || node.key.name !== 'entityType') {
          return;
        }

        // Check if value is a string literal
        if (node.value.type === 'Literal' && typeof node.value.value === 'string') {
          const value = node.value.value;
          if (!VALID_ENTITY_TYPES.has(value)) {
            context.report({
              node: node.value,
              messageId: 'unknownEntityType',
              data: { entityType: value, context: 'entityType property' },
            });
          }
        }
      },

      // Check switch case statements on entityType
      SwitchCase(node) {
        if (!node.test || node.test.type !== 'Literal') return;
        if (typeof node.test.value !== 'string') return;

        // Check if parent switch is on entityType variable
        const switchStmt = node.parent;
        if (!switchStmt || switchStmt.type !== 'SwitchStatement') return;

        const discriminant = switchStmt.discriminant;
        let isEntityTypeSwitch = false;

        // Check for switch(entityType) or switch(op.entityType)
        if (discriminant.type === 'Identifier' && discriminant.name === 'entityType') {
          isEntityTypeSwitch = true;
        } else if (
          discriminant.type === 'MemberExpression' &&
          discriminant.property.type === 'Identifier' &&
          discriminant.property.name === 'entityType'
        ) {
          isEntityTypeSwitch = true;
        }

        if (isEntityTypeSwitch) {
          const value = node.test.value;
          if (!VALID_ENTITY_TYPES.has(value)) {
            context.report({
              node: node.test,
              messageId: 'unknownEntityType',
              data: { entityType: value, context: 'switch case' },
            });
          }
        }
      },
    };
  },
};
