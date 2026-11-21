export const msLeftToday = (now: number): number => {
  const today = new Date(now);
  const nextLocalMidnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
  ).getTime();
  return nextLocalMidnight - now;
};
