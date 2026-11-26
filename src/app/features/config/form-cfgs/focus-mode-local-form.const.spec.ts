import { FOCUS_MODE_LOCAL_FORM_CFG } from './focus-mode-local-form.const';

describe('FOCUS_MODE_LOCAL_FORM_CFG', () => {
  const isNotifyFieldHidden = (): boolean => {
    const field = FOCUS_MODE_LOCAL_FORM_CFG.items!.find(
      (item) => item.key === 'isNotifyOnSessionEnd',
    );
    const hide = field?.hideExpression as () => boolean;
    return hide();
  };

  it('offers the session-end notification where the browser supports notifications', () => {
    expect(isNotifyFieldHidden()).toBe(false);
  });

  // e.g. iOS Safari outside an installed web app: the option could never work
  it('hides the session-end notification without a Notification API', () => {
    const win = window as unknown as { Notification?: unknown };
    const original = win.Notification;
    win.Notification = undefined;
    try {
      expect(isNotifyFieldHidden()).toBe(true);
    } finally {
      win.Notification = original;
    }
  });
});
