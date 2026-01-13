# Sync Flow Explained

**Last Updated:** January 2026
**Status:** Implemented

This document explains how synchronization works in simple terms.

## The Big Picture

When you make changes on one device, those changes need to reach your other devices. Here's how it works:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        YOUR CHANGE                                   │
│                                                                      │
│   Phone                    Cloud                    Desktop          │
│   ┌─────┐                 ┌─────┐                  ┌─────┐          │
│   │ You │  ──UPLOAD──►    │     │   ──DOWNLOAD──►  │     │          │
│   │edit │                 │sync │                  │sees │          │
│   │task │                 │data │                  │edit │          │
│   └─────┘                 └─────┘                  └─────┘          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Step-by-Step: What Happens When You Edit a Task

### Step 1: You Make a Change

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   You click "Mark task as done"                                      │
│                                                                      │
│   ┌──────────────────────────────────────┐                          │
│   │          Your Device                  │                          │
│   │                                       │                          │
│   │   Task: "Buy milk"                    │                          │
│   │   Status: Not Done  ──►  Done ✓       │                          │
│   │                                       │                          │
│   └──────────────────────────────────────┘                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Step 2: An "Operation" is Created

The app doesn't sync the whole task. It syncs _what changed_:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   Operation Created:                                                 │
│   ┌──────────────────────────────────────┐                          │
│   │                                       │                          │
│   │   Type:     UPDATE                    │                          │
│   │   Entity:   TASK                      │                          │
│   │   ID:       task-abc-123              │                          │
│   │   Change:   isDone = true             │                          │
│   │   When:     2026-01-08 14:30:00       │                          │
│   │   Who:      your-device-id            │                          │
│   │                                       │                          │
│   └──────────────────────────────────────┘                          │
│                                                                      │
│   This gets saved locally in IndexedDB                              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Step 3: Upload to Cloud

When sync triggers (automatically or manually):

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   Your Device                              Cloud                     │
│   ┌────────────┐                          ┌────────────┐            │
│   │            │                          │            │            │
│   │ Operations │ ────── UPLOAD ────────►  │   Stored   │            │
│   │ to sync:   │                          │            │            │
│   │ • task ✓   │                          │ • task ✓   │            │
│   │            │                          │            │            │
│   └────────────┘                          └────────────┘            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Step 4: Other Devices Download

Your other devices periodically check for new operations:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   Cloud                                    Other Device              │
│   ┌────────────┐                          ┌────────────┐            │
│   │            │                          │            │            │
│   │   Stored   │ ────── DOWNLOAD ──────►  │  Applies   │            │
│   │            │                          │  changes   │            │
│   │ • task ✓   │                          │ • task ✓   │            │
│   │            │                          │            │            │
│   └────────────┘                          └────────────┘            │
│                                                                      │
│   Now both devices show the task as done!                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## What About Conflicts?

When two devices change the same thing at the same time:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   Phone (offline)                    Desktop (offline)               │
│   ┌────────────────┐                ┌────────────────┐              │
│   │                │                │                │              │
│   │ Task: Buy milk │                │ Task: Buy milk │              │
│   │                │                │                │              │
│   │ You rename to: │                │ You mark as:   │              │
│   │ "Buy oat milk" │                │ "Done ✓"       │              │
│   │                │                │                │              │
│   │ Time: 2:30 PM  │                │ Time: 2:35 PM  │              │
│   │                │                │                │              │
│   └────────────────┘                └────────────────┘              │
│                                                                      │
│   Both go online... CONFLICT!                                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Resolution: Last Write Wins

The change made later (by timestamp) wins:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   Phone (2:30 PM)         vs          Desktop (2:35 PM)             │
│   "Buy oat milk"                      "Done ✓"                       │
│                                                                      │
│                         ⬇                                            │
│                                                                      │
│                   Desktop wins (later)                               │
│                                                                      │
│                         ⬇                                            │
│                                                                      │
│   Result on ALL devices:                                             │
│   ┌────────────────────────────────────┐                            │
│   │                                     │                            │
│   │   Task: "Buy milk" (name unchanged) │                            │
│   │   Status: Done ✓                    │                            │
│   │                                     │                            │
│   └────────────────────────────────────┘                            │
│                                                                      │
│   Note: Phone's rename was lost, but both devices are consistent    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## SuperSync vs File-Based: The Difference

### SuperSync (Server-Based)

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   Your Device              Server              Other Device          │
│   ┌────────┐              ┌────────┐           ┌────────┐           │
│   │        │              │        │           │        │           │
│   │ Upload │ ──op #5───►  │ Stores │ ◄──asks── │ "What's │          │
│   │ op #5  │              │ op #5  │   new?    │  new?"  │          │
│   │        │              │        │ ──op #5─► │        │           │
│   └────────┘              └────────┘           └────────┘           │
│                                                                      │
│   Server keeps ALL operations                                        │
│   Devices only download what they're missing                        │
│   Very efficient bandwidth                                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### File-Based (Dropbox/WebDAV)

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   Your Device              Cloud File          Other Device          │
│   ┌────────┐              ┌────────┐           ┌────────┐           │
│   │        │              │        │           │        │           │
│   │Download│ ◄──────────  │ sync-  │ ──────►   │Download│           │
│   │ whole  │              │ data.  │           │ whole  │           │
│   │ file   │              │ json   │           │ file   │           │
│   │        │ ──────────►  │        │ ◄──────   │        │           │
│   │Upload  │              │(state +│           │Upload  │           │
│   │ whole  │              │ ops)   │           │ whole  │           │
│   │ file   │              │        │           │ file   │           │
│   └────────┘              └────────┘           └────────┘           │
│                                                                      │
│   File contains EVERYTHING:                                          │
│   - Current state (all your data)                                    │
│   - Recent operations (last 200)                                     │
│   - Vector clock (for conflict detection)                           │
│                                                                      │
│   Less efficient, but works with any storage                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## The Complete Sync Cycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   1. TRIGGER                                                         │
│      ├── Timer (every few minutes)                                   │
│      ├── App starts                                                  │
│      └── Manual sync button                                          │
│                                                                      │
│              ▼                                                       │
│                                                                      │
│   2. DOWNLOAD FIRST                                                  │
│      ├── Get operations from cloud                                   │
│      ├── Check for conflicts                                         │
│      ├── Apply changes to local state                               │
│      └── Update "last synced" marker                                │
│                                                                      │
│              ▼                                                       │
│                                                                      │
│   3. UPLOAD LOCAL CHANGES                                            │
│      ├── Gather pending operations                                   │
│      ├── Send to cloud                                               │
│      └── Mark as synced                                              │
│                                                                      │
│              ▼                                                       │
│                                                                      │
│   4. DONE                                                            │
│      └── All devices now have same data                             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## What Gets Synced?

| Synced                  | Not Synced           |
| ----------------------- | -------------------- |
| Tasks                   | Local UI preferences |
| Projects                | Window position      |
| Tags                    | Cached data          |
| Notes                   | Temporary state      |
| Time tracking           |                      |
| Repeat configs          |                      |
| Issue provider settings |                      |

## Key Terms Glossary

| Term             | Meaning                                            |
| ---------------- | -------------------------------------------------- |
| **Operation**    | A record of one change (create, update, delete)    |
| **Vector Clock** | Tracks which device made changes when              |
| **LWW**          | "Last Write Wins" - later timestamp wins conflicts |
| **Piggybacking** | Getting other devices' changes during your upload  |
| **syncVersion**  | Counter that increases with each file update       |

## Key Files

| File                                                    | Purpose                     |
| ------------------------------------------------------- | --------------------------- |
| `src/app/op-log/sync/operation-log-sync.service.ts`     | Main sync orchestration     |
| `src/app/op-log/sync/operation-log-download.service.ts` | Handles downloading ops     |
| `src/app/op-log/sync/operation-log-upload.service.ts`   | Handles uploading ops       |
| `src/app/op-log/sync/conflict-resolution.service.ts`    | Resolves conflicts with LWW |
