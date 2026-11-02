import { T } from '../../t.const';
import { INBOX_PROJECT } from '../project/project.const';
import { TODAY_TAG } from '../tag/tag.const';
import { WorkContextType } from '../work-context/work-context.model';
import { getEmptyStateHint } from './get-empty-state-hint';

describe('getEmptyStateHint', () => {
  it('explains Today for the Today tag', () => {
    expect(getEmptyStateHint({ id: TODAY_TAG.id, type: WorkContextType.TAG })).toBe(
      T.WW.EMPTY_HINT_TODAY,
    );
  });

  it('explains the Inbox for the inbox project', () => {
    expect(
      getEmptyStateHint({ id: INBOX_PROJECT.id, type: WorkContextType.PROJECT }),
    ).toBe(T.WW.EMPTY_HINT_INBOX);
  });

  it('explains projects for any other project', () => {
    expect(getEmptyStateHint({ id: 'p1', type: WorkContextType.PROJECT })).toBe(
      T.WW.EMPTY_HINT_PROJECT,
    );
  });

  it('explains tags for any other tag', () => {
    expect(getEmptyStateHint({ id: 't1', type: WorkContextType.TAG })).toBe(
      T.WW.EMPTY_HINT_TAG,
    );
  });
});
