// The system's own dictation fills the box (§ 5): no microphone permission,
// no speech model. The empty box names the platform's dictation key.

export const dictationHint = (platform: string | undefined): string => {
  if (platform === 'android' || platform === 'ios')
    return 'Tap the microphone on your keyboard to dictate';
  const ua = navigator.userAgent;
  if (/Mac/.test(ua)) return 'Dictate with the dictation key or Fn twice';
  if (/Windows/.test(ua)) return 'Dictate with Win+H';
  // Most Linux desktops have no built-in dictation.
  return '';
};
