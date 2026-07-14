/**
 * Shared shape + pure helpers for the derived "full-state op" metadata pointer
 * stored at `SUP_OPS.meta` under `FULL_STATE_OPS_META_KEY`.
 *
 * Kept in one place so the `{ refs, latest }` shape and the "latest = max
 * local sequence" rule cannot drift between the upgrade-time seed (`db-upgrade.ts`,
 * which scans raw cursor values) and the runtime maintenance
 * (`operation-log-store.service.ts`, which works with decoded ops).
 */

/** A pointer to one full-state op: its `op.id` and its `seq` primary key. */
export interface FullStateOpRef {
  opId: string;
  seq: number;
}

/**
 * The derived full-state metadata: every tracked full-state op ref plus the
 * latest by append/apply sequence. `latest` is always derived from `refs` (never
 * trusted from storage), so a stale/corrupt stored `latest` self-corrects on the
 * next build.
 */
export interface FullStateOpsMetaEntry {
  refs: FullStateOpRef[];
  latest?: FullStateOpRef;
}

/**
 * The latest full-state op by durable append/apply sequence. Operation IDs are
 * generated from client wall clocks and therefore cannot order operations after
 * clock rollback or across clients.
 */
export const getLatestFullStateRef = (
  refs: ReadonlyArray<FullStateOpRef>,
): FullStateOpRef | undefined =>
  refs.reduce<FullStateOpRef | undefined>(
    (latest, ref) => (!latest || ref.seq > latest.seq ? ref : latest),
    undefined,
  );

/**
 * Builds a meta entry from refs, deriving `latest`. Copies `refs` so a stored
 * meta object can never alias a caller-owned array.
 */
export const buildFullStateOpsMeta = (
  refs: ReadonlyArray<FullStateOpRef>,
): FullStateOpsMetaEntry => {
  const latest = getLatestFullStateRef(refs);
  return latest ? { refs: [...refs], latest } : { refs: [...refs] };
};
