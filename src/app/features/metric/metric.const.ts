import { Metric } from './metric.model';

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

export const DEFAULT_METRIC_FOR_DAY: Omit<Metric, 'id'> = {
  focusSessions: [],
  remindTomorrow: false,
  reflections: [],
};
