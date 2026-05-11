export interface NotifyModel extends NotificationOptions {
  title?: string;
  translateParams?: { [key: string]: string | number };
  duration?: number;
  renotify?: boolean;
}
