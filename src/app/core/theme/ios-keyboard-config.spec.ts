import config from '../../../../capacitor.config';
import { KeyboardResize } from '@capacitor/keyboard';

describe('iOS keyboard Capacitor configuration', () => {
  it('does not let an unsanitized keyboard frame resize the native WebView', () => {
    const keyboardConfig = config.plugins?.['Keyboard'];

    expect(keyboardConfig?.['resize']).toBe(KeyboardResize.None);
  });
});
