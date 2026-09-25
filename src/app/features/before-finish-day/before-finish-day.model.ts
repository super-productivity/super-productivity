/**
 * Runs before the day is archived. Receives the day being finished — which is
 * NOT always today: the daily summary has a separate Finish Day button for past
 * days (`!isForToday`), so an action must never assume `todayStr()`.
 */
export type BeforeFinishDayAction = (dayStr: string) => Promise<'SUCCESS' | 'ERROR'>;
