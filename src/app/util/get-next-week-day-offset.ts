import { DateAdapter } from '@angular/material/core';

export const getNextWeekDayOffset = (
  dateAdapter: DateAdapter<unknown>,
  date: Date,
): number => {
  return (dateAdapter.getFirstDayOfWeek() - dateAdapter.getDayOfWeek(date) + 7) % 7 || 7;
};
