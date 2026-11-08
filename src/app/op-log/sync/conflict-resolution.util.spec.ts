import {
  isDeleteWinsOperation,
  LWW_PLANNING_OPTIONS,
  mergeMarkedDeleteWinsOps,
} from './conflict-resolution.util';
import { ActionType, Operation, OpType } from '../core/operation.types';
import {
  deleteTag,
  deleteTags,
  TAG_DELETE_WINS_MARKER,
} from '../../features/tag/store/tag.actions';

/**
 * #11489: a marked single-tag delete wins over a concurrent edit of the tag,
 * like a marked project delete. These pin the classifier's admission rules.
 */
describe('tag delete-wins classifier (#11489)', () => {
  const tagDelete = (
    overrides: Partial<Operation> = {},
    actionPayload?: unknown,
  ): Operation => ({
    id: 'op-1',
    clientId: 'clientA',
    actionType: ActionType.TAG_DELETE,
    opType: OpType.Delete,
    entityType: 'TAG',
    entityId: 'tag-1',
    payload: {
      actionPayload: actionPayload ?? { id: 'tag-1', [TAG_DELETE_WINS_MARKER]: true },
      entityChanges: [],
    },
    vectorClock: { clientA: 1 },
    timestamp: 1_000,
    schemaVersion: 1,
    ...overrides,
  });

  it('stamps the marker on every new deleteTag action, but not on deleteTags', () => {
    expect(deleteTag({ id: 'tag-1' })[TAG_DELETE_WINS_MARKER]).toBe(true);
    expect(
      (deleteTags({ ids: ['tag-1'] }) as unknown as Record<string, unknown>)[
        TAG_DELETE_WINS_MARKER
      ],
    ).toBeUndefined();
  });

  it('admits a marked single-tag delete whose payload id matches entityId', () => {
    expect(isDeleteWinsOperation(tagDelete())).toBe(true);
    expect(LWW_PLANNING_OPTIONS.isDeleteWinsAction(tagDelete())).toBe(true);
  });

  it('admits the marker regardless of schema version (no barrier)', () => {
    expect(isDeleteWinsOperation(tagDelete({ schemaVersion: 1 }))).toBe(true);
    expect(
      isDeleteWinsOperation(tagDelete({ schemaVersion: undefined as unknown as number })),
    ).toBe(true);
  });

  it('rejects an unmarked tag delete (released client / stored before)', () => {
    expect(isDeleteWinsOperation(tagDelete({}, { id: 'tag-1' }))).toBe(false);
    expect(
      isDeleteWinsOperation(
        tagDelete({}, { id: 'tag-1', [TAG_DELETE_WINS_MARKER]: 'true' }),
      ),
    ).toBe(false);
  });

  it('rejects deleteTags even when a payload carries the marker', () => {
    const bulk = tagDelete(
      {
        actionType: ActionType.TAG_DELETE_MULTIPLE,
        entityId: undefined,
        entityIds: ['tag-1', 'tag-2'],
      },
      { ids: ['tag-1', 'tag-2'], id: 'tag-1', [TAG_DELETE_WINS_MARKER]: true },
    );
    expect(isDeleteWinsOperation(bulk)).toBe(false);
  });

  it('rejects a marked delete retargeted onto another tag (entityId mismatch)', () => {
    expect(isDeleteWinsOperation(tagDelete({ entityId: 'tag-victim' }))).toBe(false);
    expect(isDeleteWinsOperation(tagDelete({}, { [TAG_DELETE_WINS_MARKER]: true }))).toBe(
      false,
    );
  });

  it('rejects malformed ops without throwing', () => {
    expect(
      isDeleteWinsOperation(
        tagDelete({ payload: null as unknown as Operation['payload'] }),
      ),
    ).toBe(false);
    expect(isDeleteWinsOperation(tagDelete({ opType: OpType.Update }))).toBe(false);
    expect(isDeleteWinsOperation(tagDelete({ entityType: 'PROJECT' }))).toBe(false);
  });

  it('accepts the marker in a flat (non multi-entity) payload', () => {
    expect(
      isDeleteWinsOperation(
        tagDelete({ payload: { id: 'tag-1', [TAG_DELETE_WINS_MARKER]: true } }),
      ),
    ).toBe(true);
  });

  it('picks a marked tag delete as the replacement base, preserving its payload', () => {
    const update = tagDelete({
      id: 'upd',
      opType: OpType.Update,
      actionType: ActionType.TAG_UPDATE,
    });
    const marked = tagDelete({ id: 'del' });
    const merged = mergeMarkedDeleteWinsOps([update, marked]);
    expect(merged?.id).toBe('del');
    expect(merged?.payload).toEqual(marked.payload);
    expect(mergeMarkedDeleteWinsOps([tagDelete({}, { id: 'tag-1' })])).toBeUndefined();
  });
  it('takes the latest marked tag delete as the replacement base (#11489)', () => {
    const older = tagDelete({ id: 'del-old', timestamp: 1_000 });
    const newer = tagDelete({ id: 'del-new', timestamp: 2_000 });
    const tieA = tagDelete({ id: 'del-a', timestamp: 3_000 });
    const tieB = tagDelete({ id: 'del-b', timestamp: 3_000 });
    expect(mergeMarkedDeleteWinsOps([newer, older])?.id).toBe('del-new');
    expect(mergeMarkedDeleteWinsOps([older, newer])?.id).toBe('del-new');
    expect(mergeMarkedDeleteWinsOps([tieB, tieA])?.id).toBe('del-b');
    expect(mergeMarkedDeleteWinsOps([tieA, tieB])?.id).toBe('del-b');
  });
});
