export const sortTagLabels = (value: unknown): string[] =>
  Array.isArray(value) ? (value as string[]).slice().sort() : [];
