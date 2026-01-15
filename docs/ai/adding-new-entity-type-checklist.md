# Adding New Entity Types Checklist

This checklist ensures new entity types integrate properly with the operation log and sync system.

## When adding a new entity type:

### 1. Type Definition (`src/app/op-log/core/operation.types.ts`)

- [ ] Add to `EntityType` union (line ~15)

### 2. Entity Registry (`src/app/op-log/core/entity-registry.ts`)

- [ ] Add entry to `ENTITY_CONFIGS` with:
  - `storagePattern`: 'adapter' | 'singleton' | 'map' | 'array' | 'virtual'
  - `featureName`: NgRx feature key
  - `payloadKey`: Key used in sync/import payloads
  - Appropriate selectors for the storage pattern:
    - **adapter**: `selectEntities`, `selectById`, `adapter`
    - **singleton**: `selectState`
    - **map**: `selectState`, `mapKey`
    - **array**: `selectState`, `arrayKey`
    - **virtual**: just `payloadKey`

### 3. Test Arrays (`src/app/op-log/core/entity-registry.spec.ts`)

- [ ] Add to `REGULAR_ENTITY_TYPES` array (line ~17) OR `SPECIAL_OPERATION_TYPES` if special
- [ ] Add to appropriate category array:
  - `ADAPTER_ENTITIES`
  - `SINGLETON_ENTITIES`
  - `MAP_ENTITIES`
  - `ARRAY_ENTITIES`
  - `VIRTUAL_ENTITIES`
- [ ] Update expected count in canary test (look for `expect(ALL_TESTED.length).toBe(...)`)

### 4. Meta-Reducers (if entity has relationships)

- [ ] Add cascade delete logic in appropriate meta-reducer under `src/app/root-store/meta/task-shared-meta-reducers/`
- [ ] Register meta-reducer in `META_REDUCERS` array in `src/app/root-store/meta/meta-reducer-registry.ts`

## When adding bulk actions:

Bulk actions operate on multiple entities atomically. Required setup:

- [ ] Set `isBulk: true` in action meta
- [ ] Use `entityIds` array (not single `entityId`)
- [ ] Ensure action has `isPersistent: true` and correct `entityType`

Example:

```typescript
updateTasks: (taskProps: { tasks: Update<Task>[] }) => ({
  ...taskProps,
  meta: {
    isPersistent: true,
    entityType: 'TASK',
    entityIds: taskProps.tasks.map((t) => t.id as string),
    opType: OpType.Update,
    isBulk: true,  // Required for bulk operations
  } satisfies PersistentActionMeta,
}),
```

## Verification

```bash
# Check the modified files
npm run checkFile src/app/op-log/core/entity-registry.ts
npm run checkFile src/app/op-log/core/operation.types.ts

# Run the entity registry tests
npm run test:file src/app/op-log/core/entity-registry.spec.ts
```

## Why this matters

The operation log system depends on hardcoded registries to:

- Convert actions to operations and back
- Apply remote operations during sync
- Handle cascade deletes atomically

Missing or incomplete registrations cause **silent failures** - operations may not replay correctly on other devices.
