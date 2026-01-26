import { Log } from '../core/log';

export const copyToClipboard = async (text: string): Promise<void> => {
  if (!navigator.clipboard || !window.isSecureContext) {
    throw new Error('Clipboard API is not available');
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    Log.err('Clipboard API failed, cannot copy to clipboard', { error });
    throw error;
  }
};
