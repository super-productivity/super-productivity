import { hasMeaningfulStateData } from './has-meaningful-state-data.util';
import { INBOX_PROJECT } from '../../features/project/project.const';

// The default app ships with only the INBOX project and the built-in system
// tags (TODAY, EM_URGENT, EM_IMPORTANT, KANBAN_IN_PROGRESS — see SYSTEM_TAG_IDS).
const SYSTEM_TAG_IDS_FIXTURE = [
  'TODAY',
  'EM_URGENT',
  'EM_IMPORTANT',
  'KANBAN_IN_PROGRESS',
];

const initialState = (): Record<string, unknown> => ({
  task: { ids: [], entities: {} },
  project: { ids: [INBOX_PROJECT.id], entities: {} },
  tag: { ids: [...SYSTEM_TAG_IDS_FIXTURE], entities: {} },
  note: { ids: [], entities: {} },
});

describe('hasMeaningfulStateData', () => {
  it('returns false for null/undefined/non-object', () => {
    expect(hasMeaningfulStateData(null)).toBe(false);
    expect(hasMeaningfulStateData(undefined)).toBe(false);
    expect(hasMeaningfulStateData('nope')).toBe(false);
    expect(hasMeaningfulStateData(42)).toBe(false);
  });

  it('returns false for an empty object', () => {
    expect(hasMeaningfulStateData({})).toBe(false);
  });

  it('returns false for the default/initial app state', () => {
    expect(hasMeaningfulStateData(initialState())).toBe(false);
  });

  it('returns true when there is at least one task', () => {
    const s = initialState();
    s.task = { ids: ['t1'], entities: {} };
    expect(hasMeaningfulStateData(s)).toBe(true);
  });

  it('returns true for a non-INBOX project', () => {
    const s = initialState();
    s.project = { ids: [INBOX_PROJECT.id, 'p1'], entities: {} };
    expect(hasMeaningfulStateData(s)).toBe(true);
  });

  it('returns true for a non-system tag', () => {
    const s = initialState();
    s.tag = { ids: [...SYSTEM_TAG_IDS_FIXTURE, 'tag1'], entities: {} };
    expect(hasMeaningfulStateData(s)).toBe(true);
  });

  it('returns false when only system tags exist', () => {
    expect(hasMeaningfulStateData(initialState())).toBe(false);
  });

  it('returns true when there is at least one note', () => {
    const s = initialState();
    s.note = { ids: ['n1'], entities: {} };
    expect(hasMeaningfulStateData(s)).toBe(true);
  });

  it('ignores malformed (non-entity) collections without throwing', () => {
    expect(hasMeaningfulStateData({ task: 'broken', project: null, tag: 123 })).toBe(
      false,
    );
  });
});
