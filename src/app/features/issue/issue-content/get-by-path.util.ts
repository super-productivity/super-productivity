export const getByPath = (obj: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) => (value as Record<string, unknown> | null | undefined)?.[key],
      obj,
    );

export const getIssueFieldValue = <TIssue>(
  issue: TIssue,
  fieldValue: string | ((issue: TIssue) => unknown),
): unknown =>
  typeof fieldValue === 'function' ? fieldValue(issue) : getByPath(issue, fieldValue);
