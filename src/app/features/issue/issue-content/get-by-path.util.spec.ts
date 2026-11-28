import { getByPath, getIssueFieldValue } from './get-by-path.util';

describe('getByPath', () => {
  it('reads a top-level field', () => {
    expect(getByPath({ title: 'A' }, 'title')).toBe('A');
  });

  it('reads a nested field', () => {
    expect(getByPath({ status: { name: 'Open' } }, 'status.name')).toBe('Open');
  });

  it('returns undefined when a step is missing', () => {
    expect(getByPath({ status: null }, 'status.name')).toBeUndefined();
    expect(getByPath({}, 'author.displayName')).toBeUndefined();
  });

  it('returns undefined for a null or undefined root', () => {
    expect(getByPath(null, 'title')).toBeUndefined();
    expect(getByPath(undefined, 'title')).toBeUndefined();
  });
});

describe('getIssueFieldValue', () => {
  it('reads a top-level field when fieldValue is a string', () => {
    expect(getIssueFieldValue({ title: 'A' }, 'title')).toBe('A');
  });

  it('reads a dotted-path field when fieldValue is a nested string path', () => {
    expect(getIssueFieldValue({ status: { name: 'Open' } }, 'status.name')).toBe('Open');
  });

  it('invokes the callback when fieldValue is a function', () => {
    const issue = { key: 'SP-1', summary: 'Fix bug' };
    expect(getIssueFieldValue(issue, (i) => `${i.key}: ${i.summary}`)).toBe(
      'SP-1: Fix bug',
    );
  });

  it('returns undefined for null or undefined issue with a string path', () => {
    expect(getIssueFieldValue(null, 'status.name')).toBeUndefined();
    expect(getIssueFieldValue(undefined, 'status.name')).toBeUndefined();
  });
});
