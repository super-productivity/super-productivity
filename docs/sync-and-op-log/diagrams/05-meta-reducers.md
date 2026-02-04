# Atomic State Consistency (Meta-Reducer Pattern)

**Last Updated:** January 2026
**Status:** Implemented

This document illustrates how meta-reducers ensure atomic state changes across multiple entities, preventing inconsistency during sync.

## Meta-Reducer Flow for Multi-Entity Operations

```mermaid
flowchart TD
    subgraph UserAction["User Action (e.g., Delete Tag)"]
        Action[deleteTag action]
    end

    subgraph MetaReducers["Meta-Reducer Chain (Atomic)"]
        Capture["stateCaptureMetaReducer<br/>━━━━━━━━━━━━━━━<br/>Captures before-state"]
        TagMeta["tagSharedMetaReducer<br/>━━━━━━━━━━━━━━━<br/>• Remove tag from tasks<br/>• Delete orphaned tasks<br/>• Clean TaskRepeatCfgs<br/>• Clean TimeTracking"]
        OtherMeta["Other meta-reducers<br/>━━━━━━━━━━━━━━━<br/>Pass through"]
    end

    subgraph FeatureReducers["Feature Reducers"]
        TagReducer["tag.reducer<br/>━━━━━━━━━━━━━━━<br/>Delete tag entity"]
    end

    subgraph Effects["Effects Layer"]
        OpEffect["OperationLogEffects<br/>━━━━━━━━━━━━━━━<br/>• Compute state diff<br/>• Create single Operation<br/>• with entityChanges[]"]
    end

    subgraph Result["Single Atomic Operation"]
        Op["Operation {<br/>  opType: 'DEL',<br/>  entityType: 'TAG',<br/>  entityChanges: [<br/>    {TAG, delete},<br/>    {TASK, update}x3,<br/>    {TASK_REPEAT_CFG, delete}<br/>  ]<br/>}"]
    end

    Action --> Capture
    Capture --> TagMeta
    TagMeta --> OtherMeta
    OtherMeta --> FeatureReducers
    FeatureReducers --> OpEffect
    OpEffect --> Result

    style UserAction fill:#fff,stroke:#333,stroke-width:2px
    style MetaReducers fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style FeatureReducers fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style Effects fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style Result fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
```

## Why Meta-Reducers vs Effects

```mermaid
flowchart LR
    subgraph Problem["❌ Effects Pattern (Non-Atomic)"]
        direction TB
        A1[deleteTag action] --> E1[tag.reducer]
        E1 --> A2[effect: removeTagFromTasks]
        A2 --> E2[task.reducer]
        E2 --> A3[effect: cleanTaskRepeatCfgs]
        A3 --> E3[taskRepeatCfg.reducer]

        Note1["Each action = separate operation<br/>Sync may deliver partially<br/>→ Inconsistent state"]
    end

    subgraph Solution["✅ Meta-Reducer Pattern (Atomic)"]
        direction TB
        B1[deleteTag action] --> M1[tagSharedMetaReducer]
        M1 --> M2["All changes in one pass:<br/>• tasks updated<br/>• repeatCfgs cleaned<br/>• tag deleted"]
        M2 --> R1[Single reduced state]

        Note2["One action = one operation<br/>All changes sync together<br/>→ Consistent state"]
    end

    style Problem fill:#ffebee,stroke:#c62828,stroke-width:2px
    style Solution fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

## State Change Detection

The `StateChangeCaptureService` computes entity changes by comparing before and after states:

```mermaid
flowchart TD
    subgraph Before["Before State (captured by meta-reducer)"]
        B1["tasks: {t1, t2, t3}"]
        B2["tags: {tag1, tag2}"]
        B3["taskRepeatCfgs: {cfg1}"]
    end

    subgraph After["After State (post-reducer)"]
        A1["tasks: {t1', t2', t3}"]
        A2["tags: {tag2}"]
        A3["taskRepeatCfgs: {}"]
    end

    subgraph Diff["State Diff Computation"]
        D1["Compare entity collections"]
        D2["Identify: created, updated, deleted"]
    end

    subgraph Changes["Entity Changes"]
        C1["TAG tag1: DELETED"]
        C2["TASK t1: UPDATED (tagId removed)"]
        C3["TASK t2: UPDATED (tagId removed)"]
        C4["TASK_REPEAT_CFG cfg1: DELETED"]
    end

    Before --> Diff
    After --> Diff
    Diff --> Changes

    style Before fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style After fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style Diff fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style Changes fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
```

## Multi-Entity Operations That Use Meta-Reducers

| Action              | Entities Affected                                             | Meta-Reducer               |
| ------------------- | ------------------------------------------------------------- | -------------------------- |
| `deleteTag`         | Tag, Tasks (remove tagId), TaskRepeatCfgs, TimeTracking       | `tagSharedMetaReducer`     |
| `deleteTags`        | Tags, Tasks, TaskRepeatCfgs, TimeTracking                     | `tagSharedMetaReducer`     |
| `deleteProject`     | Project, Tasks (cascade delete), TaskRepeatCfgs, TimeTracking | `projectSharedMetaReducer` |
| `convertToMainTask` | Parent task, Child task, Sub-tasks                            | `taskSharedMetaReducer`    |
| `moveTaskUp/Down`   | Multiple tasks (reorder)                                      | `taskSharedMetaReducer`    |

## Operation Structure with Entity Changes

```mermaid
classDiagram
    class Operation {
        +string id
        +string clientId
        +OpType opType
        +EntityType entityType
        +string entityId
        +VectorClock vectorClock
        +number timestamp
        +EntityChange[] entityChanges
    }

    class EntityChange {
        +EntityType entityType
        +string entityId
        +ChangeType changeType
        +unknown beforeState
        +unknown afterState
    }

    class ChangeType {
        <<enumeration>>
        CREATED
        UPDATED
        DELETED
    }

    Operation --> EntityChange : contains 0..*
    EntityChange --> ChangeType : has
```

## Sync Replay: All-or-Nothing

When remote operations are applied, all entity changes are replayed atomically:

```mermaid
sequenceDiagram
    participant Remote as Remote Op
    participant Applier as OperationApplierService
    participant Store as NgRx Store
    participant State as Final State

    Remote->>Applier: Operation with entityChanges[]

    loop For each entityChange
        Applier->>Applier: Convert to action
        Applier->>Store: dispatch(action)
    end

    Note over Store: All changes applied<br/>in single reducer pass

    Store->>State: Consistent state

    Note over State: Either ALL changes applied<br/>or NONE (transaction semantics)
```

## LWW Update Meta-Reducer: Entity Type Handling

The `lwwUpdateMetaReducer` handles LWW Update actions (created when the local side wins a conflict). It distinguishes between three entity storage patterns:

```mermaid
flowchart TD
    subgraph Input["LWW Update Action"]
        Action["[TASK] LWW Update<br/>entityType + entityId + winningData"]
    end

    subgraph Lookup["Entity Registry Lookup"]
        Registry["Look up entity storage pattern<br/>in entity registry"]
    end

    subgraph Patterns["Storage Pattern Handling"]
        Adapter["ADAPTER ENTITIES<br/>━━━━━━━━━━━━━━━<br/>TASK, PROJECT, TAG, NOTE,<br/>TASK_REPEAT_CFG, ISSUE_PROVIDER,<br/>SIMPLE_COUNTER, BOARD, METRIC,<br/>REMINDER, PLUGIN_USER_DATA,<br/>PLUGIN_METADATA<br/>━━━━━━━━━━━━━━━<br/>adapter.updateOne() or addOne()<br/>+ relationship syncing"]

        Singleton["SINGLETON ENTITIES<br/>━━━━━━━━━━━━━━━<br/>GLOBAL_CONFIG,<br/>TIME_TRACKING,<br/>MENU_TREE,<br/>WORK_CONTEXT<br/>━━━━━━━━━━━━━━━<br/>Entire feature state replaced<br/>with winning data"]

        Unsupported["UNSUPPORTED<br/>━━━━━━━━━━━━━━━<br/>Map, array, virtual<br/>━━━━━━━━━━━━━━━<br/>Warning logged,<br/>no action taken"]
    end

    Input --> Lookup
    Lookup --> Patterns

    style Adapter fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style Singleton fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style Unsupported fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
```

### Adapter Entity Details

For adapter-backed entities, the meta-reducer handles two sub-cases:

| Condition              | Behavior                                                  | Why                                                                                |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Entity exists in store | `adapter.updateOne()` — replaces entity with winning data | Normal conflict resolution                                                         |
| Entity NOT in store    | `adapter.addOne()` — recreates entity                     | Handles DELETE vs UPDATE race (entity was deleted locally but update won remotely) |

### Relationship Syncing for Tasks

After updating a task via LWW, the meta-reducer syncs related entity references:

| Field Changed | Relationship Synced                                                |
| ------------- | ------------------------------------------------------------------ |
| `projectId`   | `project.taskIds` updated to reflect new/old project membership    |
| `tagIds`      | `tag.taskIds` updated for each added/removed tag                   |
| `dueDay`      | `TODAY_TAG.taskIds` updated (virtual tag, membership via `dueDay`) |
| `parentId`    | `parent.subTaskIds` updated for new/old parent task                |

**Key file:** `src/app/root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer.ts`

## Key Files

| File                                                                           | Purpose                                                   |
| ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `src/app/root-store/meta/task-shared-meta-reducers/`                           | Task-related multi-entity changes                         |
| `src/app/root-store/meta/task-shared-meta-reducers/tag-shared.reducer.ts`      | Tag deletion with cleanup                                 |
| `src/app/root-store/meta/task-shared-meta-reducers/project-shared.reducer.ts`  | Project deletion with cleanup                             |
| `src/app/root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer.ts` | LWW Update handling (adapter/singleton/relationship sync) |
