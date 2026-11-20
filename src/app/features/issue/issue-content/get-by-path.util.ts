export const getByPath = (obj: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) => (value as Record<string, unknown> | null | undefined)?.[key],
      obj,
    );
