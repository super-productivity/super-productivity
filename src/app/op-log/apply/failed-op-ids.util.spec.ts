import { getFailedOpIdsFromBatch } from './failed-op-ids.util';
import { Operation } from '../core/operation.types';

const op = (id: string): Operation => ({ id }) as Operation;

describe('getFailedOpIdsFromBatch', () => {
  it('returns the failed op and every op after it (slice-from-failure)', () => {
    const ops = [op('a'), op('b'), op('c'), op('d')];
    expect(getFailedOpIdsFromBatch(ops, op('b'))).toEqual(['b', 'c', 'd']);
  });

  it('returns just the last op when it is the one that failed', () => {
    const ops = [op('a'), op('b'), op('c')];
    expect(getFailedOpIdsFromBatch(ops, op('c'))).toEqual(['c']);
  });

  it('returns all ops when the first one failed', () => {
    const ops = [op('a'), op('b'), op('c')];
    expect(getFailedOpIdsFromBatch(ops, op('a'))).toEqual(['a', 'b', 'c']);
  });

  it('falls back to only the failed op when it is not in the batch (defensive -1 guard)', () => {
    // Guards against slice(-1) wrongly selecting just the last op.
    const ops = [op('a'), op('b'), op('c')];
    expect(getFailedOpIdsFromBatch(ops, op('x'))).toEqual(['x']);
  });
});
