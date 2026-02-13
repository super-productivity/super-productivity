# Vector Clock Pruning: Literature Review & Best Practices

Research compiled Feb 2026 to validate and contextualize the pruning strategy used in Super Productivity's sync system.

---

## 1. The Core Problem

Vector clocks grow linearly with the number of participating clients. In a system where users may use 10–20+ devices over time, unbounded clocks waste storage and bandwidth. Pruning reduces clock size at the cost of **false concurrency** — pruned entries can make two causally ordered events appear concurrent.

**Key insight from all sources:** False concurrency is safe (creates conflicts to resolve), while false ordering (incorrectly declaring one clock greater than another) causes silent data loss.

---

## 2. Pruning Strategies in the Literature

### 2.1 Amazon Dynamo (2007) — Size-Based Pruning

- **Strategy:** Drop the oldest entry (by wall-clock timestamp) when the clock exceeds a threshold (~10 entries).
- **Trade-off:** Simple but relies on timestamps for "oldest" determination, which can be inaccurate across nodes.
- **Source:** DeCandia et al., "Dynamo: Amazon's Highly Available Key-value Store," SOSP 2007, Section 4.4.

### 2.2 Riak (Pre-2.0) — Hybrid Size + Time Pruning

- **Strategy:** Four tunable parameters control pruning:
  - `small_vclock` / `big_vclock` — size thresholds
  - `young_vclock` / `old_vclock` — age thresholds
- **Behavior:**
  - Clocks smaller than `small_vclock` are never pruned
  - Clocks younger than `young_vclock` are never pruned
  - Clocks older than `old_vclock` are aggressively pruned
  - Clocks larger than `big_vclock` are pruned regardless of age
- **Known bug (Riak #613):** Pruning before comparison caused siblings to accumulate indefinitely. The fix was identical to ours: prune after comparison, before storage.
- **Source:** Basho Riak documentation; GitHub issue basho/riak_kv#613.

### 2.3 Voldemort (LinkedIn) — Activity-Based Pruning

- **Strategy:** Strip entries for nodes/replicas that have been retired or are no longer active participants.
- **Rationale:** In a fixed-replica system, only active replicas need clock entries.
- **Not applicable to Super Productivity:** Our "replicas" are user devices that come and go unpredictably.
- **Source:** Project Voldemort documentation and source code.

### 2.4 Causal Stability (CRDTs) — Theoretical Approach

- **Strategy:** Compute the component-wise minimum across all replicas' known clocks (the "stable cut"). Events below this threshold are causally stable — all replicas have seen them — and their clock entries can be safely garbage collected.
- **Requirement:** Requires periodic metadata exchange between all replicas to compute the stable cut.
- **Trade-off:** No false concurrency (exact GC), but requires all-to-all communication.
- **Not practical for Super Productivity:** Devices are intermittently connected; computing a stable cut requires all clients to be reachable.
- **Source:** Almeida et al., "Scalable and Accurate Causality Tracking for Eventually Consistent Stores," DISC 2014.

---

## 3. Alternatives That Avoid Pruning Entirely

### 3.1 Dotted Version Vectors (Riak 2.0+)

- **Concept:** Bounds clock size to the number of **replicas** (not clients). Each entry tracks a replica's latest event plus a "dot" (single event marker) for the specific write.
- **Benefit:** Clock size = number of replicas, which is fixed and small (typically 3–5).
- **Limitation:** Requires a fixed, known replica set. Not directly applicable when every user device is a "replica."
- **Source:** Preguiça et al., "Dotted Version Vectors: Logical Clocks for Optimistic Replication," arXiv:1011.5808.

### 3.2 Interval Tree Clocks

- **Concept:** Uses a tree structure that dynamically adapts to the set of active participants. Nodes can fork (new participant) and join (participant retires) without growing unboundedly.
- **Benefit:** Naturally adapts to changing participant sets without pruning.
- **Limitation:** More complex implementation; not widely adopted in production systems.
- **Source:** Almeida et al., "Interval Tree Clocks: A Logical Clock for Dynamic Systems," OPODIS 2008.

### 3.3 Last-Writer-Wins with Timestamps (Cassandra)

- **Concept:** Abandons vector clocks entirely. Uses wall-clock timestamps for conflict resolution — latest timestamp wins.
- **Benefit:** O(1) metadata per entry. No clock growth problem.
- **Limitation:** Clock skew can cause silent data loss. No true conflict detection — concurrent writes are silently resolved by timestamp.
- **Why not for Super Productivity:** User devices have unreliable clocks; silent data loss is unacceptable for a personal productivity app.

---

## 4. The Critical Rule: Compare Before Pruning

This is the single most important finding, confirmed across multiple sources:

> **Never prune a vector clock before using it in a comparison.**

### Why

Pruning removes information. If clock A has entries `{X:1, Y:2, Z:3}` and you prune Z before comparing against `{X:1, Y:2, Z:3}`, clock A appears to lack knowledge of Z — making the comparison return CONCURRENT instead of EQUAL.

### Historical Bugs

1. **Riak #613:** Pruning before comparison caused "sibling explosion" — objects accumulated hundreds of siblings that could never be resolved because the pruned clocks always appeared concurrent.
2. **Super Productivity (Feb 2026):** Server pruning before comparison caused an infinite rejection loop when MAX was 10. Client K merges all clocks + its own ID (11 entries), server prunes to 10, non-shared keys cause CONCURRENT, server rejects, client re-merges, loop repeats. Fixed by increasing MAX to 20 and moving pruning to after comparison.

### The Fix (Both Systems)

```
1. Receive full clock from client
2. Compare full (unpruned) clock against stored clock
3. If accepted: prune THEN store
4. If rejected: return rejection with stored clock for client-side resolution
```

---

## 5. Pruning-Aware Comparison

When both clocks have been pruned, standard comparison is unreliable because missing entries could mean either "never knew about this client" or "entry was pruned." Two approaches exist:

### 5.1 Conservative (Super Productivity's approach)

When both clocks are at MAX size:

- Only compare shared keys
- If non-shared keys exist on the losing side, return CONCURRENT
- Rationale: Non-shared keys might represent unknown causal history

### 5.2 Riak's Approach (Pre-2.0)

- Treat missing entries in pruned clocks as 0 (standard comparison)
- Accept the resulting false concurrency as siblings
- Resolve siblings on read via application-level merge

### Trade-off

Super Productivity's conservative approach generates more conflicts but never produces false ordering. Riak's approach generates fewer conflicts but requires a robust sibling merge mechanism.

---

## 6. Validation of Super Productivity's Design

The project's current architecture uses a simple 2+1 layer approach:

| Layer                             | Current Mechanism                                        | Precedent                             |
| --------------------------------- | -------------------------------------------------------- | ------------------------------------- |
| 1. Server prunes after comparison | Full clock comparison, prune before storage              | Dynamo, Riak (post-#613 fix)          |
| 2. Same-client check              | Monotonic counter comparison for import client's own ops | Novel — always mathematically correct |

### What the Literature Validates

- Size-based pruning with a fixed MAX is the standard approach (Dynamo, Riak)
- Compare-before-prune is essential (Riak #613, Dynamo best practices)
- False concurrency from pruning is the safe direction (all sources agree)
- Fixing root causes (too-small MAX) over adding defense layers is standard engineering practice

### What's Novel to This Project

- The same-client check — leveraging monotonic counters for definitive post-import detection (always mathematically correct regardless of MAX size)

### Why MAX=20 Simplified Everything

The original 4-layer defense (protected client IDs, pruning-aware comparison, `isLikelyPruningArtifact`, same-client check) was designed to work around a root cause: MAX=10 was too small, making pruning a frequent occurrence that interacted badly with SYNC_IMPORT operations. Commit `d70f18a94d` increased MAX from 10 to 30, which was later reduced to 20 (a 20-entry clock is ~333 bytes — negligible overhead), and removed the defense layers that were treating symptoms rather than the cause. With MAX=20, pruning requires 21+ unique client IDs — an extremely rare scenario for a personal productivity app. The `isLikelyPruningArtifact` heuristic was also removed since it had known false positives and was unnecessary at MAX=20. Only the same-client check remains as a safety net — it's always mathematically correct (monotonic counters are definitive).

---

## 7. Potential Future Improvements

### 7.1 Dotted Version Vectors (If Server Becomes the Authority)

If the architecture evolves toward a server-centric model where the server is the primary coordinator (rather than a relay), Dotted Version Vectors could bound clock size to the number of active server "vnodes" rather than client devices.

### 7.2 Client Registration with Bounded IDs

Assign clients numeric IDs from a small, bounded set (e.g., 0–15). When a client retires, its ID can be reclaimed. This bounds clock size without pruning but requires a registration/retirement protocol.

### 7.3 Periodic Stable-Cut GC

If clients periodically report their known clock state to the server, the server could compute a stable cut and notify clients which entries are safe to GC. This eliminates false concurrency from pruning but requires all-to-all communication.

---

## 8. Sources

1. DeCandia, G. et al. (2007). "Dynamo: Amazon's Highly Available Key-value Store." SOSP '07.
2. Almeida, P. S. et al. (2008). "Interval Tree Clocks: A Logical Clock for Dynamic Systems." OPODIS '08.
3. Preguiça, N. et al. (2010). "Dotted Version Vectors: Logical Clocks for Optimistic Replication." arXiv:1011.5808.
4. Almeida, P. S. et al. (2014). "Scalable and Accurate Causality Tracking for Eventually Consistent Stores." DISC '14.
5. Basho Riak documentation — Vector Clocks, Dotted Version Vectors.
6. Basho/riak_kv GitHub issue #613 — Sibling explosion from pre-comparison pruning.
7. Project Voldemort documentation — Versioning and conflict resolution.
8. Apache Cassandra documentation — Timestamps and conflict resolution.
