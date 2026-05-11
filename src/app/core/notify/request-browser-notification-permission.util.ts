export const requestBrowserNotificationPermissionIfEnabled = (
  isEnabled: boolean | null | undefined,
): void => {
  if (
    !isEnabled ||
    !('Notification' in window) ||
    Notification.permission !== 'default'
  ) {
    return;
  }

  void Notification.requestPermission();
};
