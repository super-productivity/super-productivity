import { Log } from '../core/log';

export const copyToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      Log.err('Clipboard API failed, cannot copy to clipboard', {
        error,
      });
    }
  }
};
