import { OpType } from './operation.types';

export interface FullStateOpTypeHelpers<TOpType extends string = string> {
  FULL_STATE_OP_TYPES: ReadonlySet<TOpType>;
  isFullStateOpType: (opType: string) => opType is TOpType;
}

/**
 * Creates host-owned helpers for classifying operations that replace full state.
 *
 * Full-state operation names are application wire conventions, so sync-core
 * only provides the classification helper and the host supplies the op strings.
 */
export const createFullStateOpTypeHelpers = <TOpType extends string>(
  fullStateOpTypes: readonly TOpType[],
): FullStateOpTypeHelpers<TOpType> => {
  const fullStateOpTypeSet: ReadonlySet<TOpType> = new Set(fullStateOpTypes);

  return {
    FULL_STATE_OP_TYPES: fullStateOpTypeSet,
    isFullStateOpType: (opType: string): opType is TOpType =>
      fullStateOpTypeSet.has(opType as TOpType),
  };
};

const compatibilityFullStateOpTypeHelpers = createFullStateOpTypeHelpers<OpType>([
  OpType.SyncImport,
  OpType.BackupImport,
  OpType.Repair,
]);

/**
 * @deprecated Super Productivity compatibility export. Hosts should instantiate
 * their own helper with `createFullStateOpTypeHelpers()`.
 */
export const FULL_STATE_OP_TYPES =
  compatibilityFullStateOpTypeHelpers.FULL_STATE_OP_TYPES;

/**
 * @deprecated Super Productivity compatibility export. Hosts should instantiate
 * their own helper with `createFullStateOpTypeHelpers()`.
 */
export const isFullStateOpType = compatibilityFullStateOpTypeHelpers.isFullStateOpType;
