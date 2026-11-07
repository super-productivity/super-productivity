export const mapLegacyPlannedAt = <T extends Record<string, unknown>>(fields: T): T => {
  const result: Record<string, unknown> = { ...fields };
  if (
    Object.prototype.hasOwnProperty.call(result, 'plannedAt') &&
    !Object.prototype.hasOwnProperty.call(result, 'dueWithTime')
  ) {
    result.dueWithTime = result.plannedAt;
  }
  delete result.plannedAt;

  // dueWithTime wins over dueDay (ARCHITECTURE-DECISIONS.md Decision #1).
  // Callers that send both (common for calendar-style POSTs) must not leave
  // the task in planner.days and in a timed slot at once (#11263).
  if (typeof result.dueWithTime === 'number') {
    delete result.dueDay;
  }

  return result as T;
};
