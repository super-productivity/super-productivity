export const mapLegacyPlannedAt = <T extends Record<string, unknown>>(fields: T): T => {
  const result: Record<string, unknown> = { ...fields };
  if (
    Object.prototype.hasOwnProperty.call(result, 'plannedAt') &&
    !Object.prototype.hasOwnProperty.call(result, 'dueWithTime')
  ) {
    result.dueWithTime = result.plannedAt;
  }
  delete result.plannedAt;

  return result as T;
};
