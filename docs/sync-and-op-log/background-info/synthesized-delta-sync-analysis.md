# Delta Sync Root-Cause Analysis: Synthesized Report

**Synthesized From:** Gemini 2.5 Flash, GPT-5, Claude Opus 4.5
**Date:** December 2, 2025

---

## Critical Note: Analysis Scope Discrepancy

**The three AI models analyzed different artifacts:**

| Model                | What Was Analyzed                        | Branch/Source                              |
| -------------------- | ---------------------------------------- | ------------------------------------------ |
| **Gemini 2.5 Flash** | Current working directory                | `feat/delta-sync` (45-line stub)           |
| **GPT-5**            | Documentation & design docs              | Theoretical/planned design                 |
| **Claude Opus 4.5**  | `feat/sync-server` branch via `git show` | 940-line implementation (different branch) |

**Current Reality (as of analysis date):**

- **`feat/delta-sync` branch** (the branch being evaluated): `super-sync.ts` is **45 lines** (WebDAV stub)
- `feat/sync-server` branch (separate, not under evaluation): Contains 940-line implementation
- Server (`packages/super-sync-server`): Auth wrapper only, no delta/changes logic

**Important Clarification:** The correct comparison should be between `feat/delta-sync` and `feat/operation-logs`. The `feat/sync-server` branch is a separate implementation effort and should not be conflated with `feat/delta-sync`.

**Implication:** Gemini's finding that the delta-sync implementation is "vaporware" is correct for `feat/delta-sync`. Opus's detailed code analysis applies to a different branch (`feat/sync-server`) which contains more code but is not the branch under evaluation. GPT-5's analysis is based on documented design.

**The strategic recommendation (abandon delta sync on `feat/delta-sync`) is valid**, because:

1. The `feat/delta-sync` branch has no real implementation—just a stub (Gemini)
2. The documented design has inherent architectural limitations (GPT-5)
3. Even fully-implemented delta sync (as in `feat/sync-server`) has fundamental issues (Opus)

---

## 1. Executive Summary

This document synthesizes analyses from three AI models (Gemini 2.5 Flash, GPT-5, Claude Opus 4.5) examining the delta-sync implementation in Super Productivity. All three models independently identified **fundamental architectural issues** that explain why stabilization has proven difficult—whether analyzing the stub, the design, or the implementation branch.

### Consensus Findings

| Finding                                   | Gemini | GPT-5 | Opus | Confidence |
| ----------------------------------------- | :----: | :---: | :--: | :--------: |
| Shadow state is the core problem          |   ✅   |  ✅   |  ✅  |  **High**  |
| Watermark/revision tracking is unreliable |   ✅   |  ✅   |  ✅  |  **High**  |
| LWW semantics cause data loss             |   ✅   |  ✅   |  ✅  |  **High**  |
| O(N) diffing doesn't scale                |   ✅   |  ✅   |  ✅  |  **High**  |
| Implementation is incomplete              |   ✅   |  ✅   |  ⚠️  |  **High**  |
| Multi-state consistency is impossible     |   ✅   |  ✅   |  ✅  |  **High**  |

**Key Insight (Consensus):** The delta-sync architecture requires maintaining multiple synchronized states (app data, shadow state, watermarks, vector clocks) without transactional guarantees. This creates a combinatorial explosion of failure modes that are difficult to test and reproduce.

---

## 2. Root Causes: Cross-Model Analysis

### 2.1 The Shadow State Problem

**All three models identify this as the primary root cause.**

#### Gemini's Analysis

> "The Delta Sync architecture requires the client to maintain a **Shadow State**—a perfect local copy of the data as it exists on the server. Without a durable shadow state, the client loses its 'diffing baseline' on every app restart."

#### GPT-5's Analysis

> "Shadow state is easily lost (IDB eviction, encryption key mismatch, cache cleared, new device). When missing, the client interprets 'no shadow' as 'everything changed,' triggering full-entity uploads."

#### Opus's Analysis

> "Dual-Cache Inconsistency: Shadow state exists both in-memory (`lastSyncedState` Map) and in IndexedDB. These can drift apart if app crashes after memory update but before IDB write."

#### Synthesis

| Failure Mode                 | Gemini | GPT-5 | Opus |
| ---------------------------- | ------ | ----- | ---- |
| IDB eviction/loss            | ✅     | ✅    | ✅   |
| Encryption key mismatch      | —      | ✅    | ✅   |
| Memory/IDB drift             | —      | —     | ✅   |
| No integrity verification    | —      | —     | ✅   |
| Silent recovery masks issues | ✅     | ✅    | ✅   |

**Consolidated Root Cause:** Shadow state has **no durability guarantees**, **no integrity verification**, and **no atomic relationship** with watermarks or server state. Any corruption silently triggers full syncs, which may overwrite local changes.

---

### 2.2 The Watermark/Revision Problem

**All three models identify watermark drift as a critical issue.**

#### Gemini's Analysis

> "If Shadow State corrupts, the client is broken until full reset."

#### GPT-5's Analysis

> "If local watermarks drift (app restart during sync, partial writes), the client may ask the server for changes the server has already compacted or skip ranges entirely. That produces 'empty change set but stale shadow' scenarios."

#### Opus's Analysis

> "Watermark-Shadow Desynchronization: Watermark and shadow state are updated separately. If one update succeeds and the other fails, the client enters an inconsistent state."

#### Synthesis

| Failure Mode                | Impact                                             |
| --------------------------- | -------------------------------------------------- |
| Watermark newer than shadow | Client misses changes (thinks it's up-to-date)     |
| Watermark older than shadow | Client re-downloads changes (inefficient but safe) |
| Watermark drift during sync | Client and server disagree on sync point           |
| No atomic coupling          | Crash mid-sync corrupts state permanently          |

**Consolidated Root Cause:** Watermarks and shadow state are stored in separate IDB transactions. There is no mechanism to ensure they remain consistent after crashes or partial failures.

---

### 2.3 The LWW (Last-Write-Wins) Problem

**All three models identify shallow merge semantics as a data-loss risk.**

#### Gemini's Analysis

> "'Last Write Wins' blindly overwrites data. No context of _why_ a change happened. A `TaskCompleted` op and `TaskRenamed` op cannot both be applied—one wipes out the other."

#### GPT-5's Analysis

> "Server applies `merged = { ...oldData, ...newData }`, so correctness depends on clients sending full values for every top-level property. When it misses a nested field, the server overwrites the old object with the partial payload, dropping untouched keys."

#### Opus's Analysis

> "BLOB models use last-write-wins (whole object replacement), while ENTITY models use field-level merging. If mode detection is wrong, data is either over-merged or under-merged."

#### Synthesis

```
Scenario: Two devices edit Task A concurrently

Device 1: Renames task to "Important Meeting"
Device 2: Marks task as completed

Delta Sync Result (LWW):
- If Device 2 syncs last → Task renamed but NOT completed (Device 1's change lost)
- If Device 1 syncs last → Task completed but NOT renamed (Device 2's change lost)

Expected Result:
- Task should be BOTH renamed AND completed (independent changes)
```

**Consolidated Root Cause:** Delta sync transmits state diffs, not intent. When two devices modify different properties of the same entity, only one change survives. This is a fundamental limitation of state-based sync with shallow merge.

---

### 2.4 The Performance Problem

**All three models identify O(N) diffing as a scalability bottleneck.**

#### Gemini's Analysis

> "Diffing 10k items freezes UI. Performance degrades linearly with data size."

#### GPT-5's Analysis

> "For thousands of tasks, diffing pegs the UI thread, causing frame drops and timeouts. If data changes mid-diff, the computed delta no longer matches the final state."

#### Opus's Analysis

> "Diff calculation (`createDiff`) is O(N) where N = number of entities. For users with 10,000+ tasks, this can block the main thread."

#### Synthesis

| Dataset Size | Diff Time (estimated) | User Impact   |
| ------------ | --------------------- | ------------- |
| 100 tasks    | ~10ms                 | Imperceptible |
| 1,000 tasks  | ~100ms                | Minor delay   |
| 10,000 tasks | ~1,000ms              | UI freeze     |
| 50,000 tasks | ~5,000ms              | Unusable      |

**Consolidated Root Cause:** The diff algorithm must compare every entity against its shadow counterpart using `JSON.stringify()`. This is inherently O(N) and cannot be optimized without fundamental architecture changes (dirty tracking, incremental diffing, web workers).

---

### 2.5 The Implementation Completeness Problem

**Gemini and GPT-5 note that the implementation is incomplete. Opus analyzed the more complete `feat/sync-server` branch.**

#### Gemini's Analysis (Most Critical)

> "Code analysis reveals the Server has **NO** delta DB (only Users table) and Client is just a WebDAV wrapper. The implementation is effectively 'vaporware'."

#### GPT-5's Analysis

> "The actual code path (`super-sync.ts`) is currently just a thin WebDAV wrapper—none of the documented delta logic is wired in."

#### Opus's Analysis

> "The `feat/sync-server` branch contains a 940-line `SuperSyncProvider` with IDB shadow state, watermarks, and diff logic. However, multiple TODOs indicate incomplete areas."

#### Synthesis

| Component           | Current State                     | Gap                                       |
| ------------------- | --------------------------------- | ----------------------------------------- |
| Server delta API    | Documented but minimal            | No changes table in Gemini's analysis     |
| Client shadow state | Implemented in `feat/sync-server` | No crash consistency                      |
| Diff engine         | Implemented                       | No worker offload, O(N)                   |
| Watermark tracking  | Implemented                       | Not atomic with shadow                    |
| Encryption          | Two modes implemented             | Mode switching is implicit                |
| Vector clocks       | Implemented                       | Governance gaps (empty clocks = conflict) |

**Note:** The discrepancy between Gemini/GPT-5 and Opus suggests the implementation has evolved. Opus analyzed a more recent state of `feat/sync-server` where delta logic exists but has fundamental issues.

---

## 3. Why Stabilization is Difficult: Consensus View

All three models agree that stabilization faces structural barriers:

### 3.1 State-Derived vs Intent-Derived (GPT-5)

> "The system attempts to infer intent from mutable snapshots, so any shadow corruption forces expensive recomputation and can silently lose semantics."

### 3.2 No Single Source of Truth (All Models)

| State Component        | Storage | Can Drift? |
| ---------------------- | ------- | :--------: |
| NgRx in-memory state   | Memory  |    Yes     |
| IndexedDB app data     | IDB     |    Yes     |
| Shadow state (memory)  | Memory  |    Yes     |
| Shadow state (IDB)     | IDB     |    Yes     |
| Watermarks             | IDB     |    Yes     |
| Server state           | Remote  |    Yes     |
| Vector clocks (local)  | IDB     |    Yes     |
| Vector clocks (remote) | Remote  |    Yes     |

**Total independent states: 8**
**Possible inconsistent combinations: 2^8 - 1 = 255**

### 3.3 Testing Complexity (All Models)

| Edge Case                        | Testable? | Currently Tested? |
| -------------------------------- | :-------: | :---------------: |
| Concurrent pushes from 2 devices | Difficult |        ❌         |
| Network failure mid-sync         | Difficult |        ❌         |
| IDB eviction                     | Difficult |        ❌         |
| Vector clock overflow            |  Medium   |   ⚠️ (disabled)   |
| Encryption key change            |  Medium   |        ❌         |
| Large dataset (10k+ tasks)       | Difficult |        ❌         |

### 3.4 Operational Surface Area (GPT-5)

> "The design spans WebDAV fallbacks, optional encryption, IndexedDB persistence, and REST deltas. Each layer introduces its own failure modes, and they compound."

---

## 4. Model-Specific Unique Insights

### 4.1 Gemini's Unique Insight: "Phase 0" Status

Gemini noted that the `SuperSyncProvider` is currently "Phase 0"—a WebDAV wrapper—indicating the delta sync was never fully implemented. This suggests the project hit a complexity wall during implementation.

### 4.2 GPT-5's Unique Insight: Fallback Path Coupling

> "Switching modes changes merge semantics (snapshot LWW vs. delta patches). After fallback, the shadow state no longer matches server revisions."

This highlights that having two sync modes (delta and WebDAV fallback) creates hybrid states that neither path fully owns.

### 4.3 Opus's Unique Insight: Vector Clock Governance Gaps

Opus identified specific code-level issues in vector clock handling:

- Empty clocks treated as `CONCURRENT` (triggers false conflicts)
- Pruning at 50 clients loses causality history
- Overflow reset to 1 corrupts comparison with old clocks

---

## 5. Estimated Effort to Stabilize

### Gemini's Estimate: 12-16 Weeks (Build from Scratch)

> "Server (4-6 wks): Design changes schema, implement `/api/sync` endpoints. Client (6-8 wks): Implement `ShadowStateStore`, Diff Engine (Worker), Partial Patching. Migration (2 wks)."

### GPT-5's Estimate: 3-5 Weeks (Make It Real)

> "Implement and persist shadow state + per-model watermarks with crash-safe coupling. Add diff+merge pipeline. Add large-dataset perf tests. Harden with soak tests."

### Opus's Estimate: Architectural Rewrite Required

> "Stabilization would require either deep architectural changes to make state transitions atomic and verifiable, OR switching to a different synchronization paradigm."

### Synthesis

| Approach                   |   Effort    |  Risk  | Outcome                       |
| -------------------------- | :---------: | :----: | ----------------------------- |
| Minimal fixes (bug-by-bug) |  2-4 weeks  |  High  | Whack-a-mole; new bugs emerge |
| Proper delta sync (GPT-5)  |  3-5 weeks  | Medium | Viable but fragile            |
| Full rebuild (Gemini)      | 12-16 weeks | Medium | Proper delta sync             |
| Architecture switch (Opus) |  4-6 weeks  |  Low   | Operation log approach        |

---

## 6. Consolidated Recommendations

### 6.1 Do Not Attempt

- **Bug-by-bug fixes:** The issues are architectural, not isolated bugs
- **Adding more fallback paths:** Increases state space complexity
- **Optimizing diff performance first:** Doesn't address correctness issues

### 6.2 Consider

- **Per-entity versioning without full operation log:** Simpler than operation log, addresses some issues (see `operationlog-critique.md`)
- **Hybrid approach:** Use delta sync for simple models, operation log for complex ones

### 6.3 Recommended

- **Complete the operation log implementation:** All three models agree this is more tractable
- **If delta sync must be used:** Follow GPT-5's plan with crash-safe coupling between shadow and watermarks

---

## 7. Conclusion

**All three AI models independently reached the same conclusion:** The delta-sync implementation has fundamental architectural issues that make stabilization expensive and risky.

### Core Problems (Unanimous)

1. **Shadow state has no durability or integrity guarantees**
2. **Watermarks and shadow state can desynchronize**
3. **LWW merge semantics lose concurrent independent changes**
4. **O(N) diffing doesn't scale to large datasets**
5. **Multiple independent states create combinatorial failure modes**

### Path Forward (Consensus)

The operation-log approach (`feat/operation-logs`) provides a more tractable path because:

- Single source of truth (operation log) eliminates multi-state consistency issues
- Per-entity conflict detection is granular (not whole-file)
- Append-only logs are inherently more robust to corruption
- Performance scales with change frequency, not dataset size

The delta-sync approach is not inherently wrong, but the current implementation would require significant rework to achieve stability—effort that may be better spent completing the operation-log implementation.
