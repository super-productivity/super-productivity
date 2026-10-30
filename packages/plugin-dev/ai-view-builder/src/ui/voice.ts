// Push-to-talk in the web build only. In the desktop app the microphone
// permission is denied and Chromium's cloud recognizer does not work; Android's
// WebView has no working recognizer and iOS needs usage strings. There the
// prompt box takes the system's own dictation instead. A host speech service
// that covers every platform is planned (docs/plans/2026-10-30-generative-views.md).

interface RecognitionResultList {
  length: number;
  [index: number]: { isFinal: boolean; 0: { transcript: string } };
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  processLocally?: boolean;
  onresult: ((e: { results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface RecognitionCtor {
  new (): Recognition;
  available?: (opts: { langs: string[]; processLocally: boolean }) => Promise<string>;
}

const getCtor = (): RecognitionCtor | null => {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const isVoiceSupported = (platform: string): boolean =>
  platform === 'web' && !!getCtor();

/** Whether the browser can recognize this language on the device (no audio leaves it). */
export const isOnDevice = async (lang: string): Promise<boolean> => {
  const Ctor = getCtor();
  if (!Ctor?.available) return false;
  try {
    return (
      (await Ctor.available({ langs: [lang], processLocally: true })) === 'available'
    );
  } catch {
    return false;
  }
};

export interface ListenHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

export const listen = (
  lang: string,
  onDevice: boolean,
  handlers: ListenHandlers,
): { stop: () => void } | null => {
  const Ctor = getCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  if (onDevice) rec.processLocally = true;
  rec.onresult = (e) => {
    let text = '';
    let isFinal = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      isFinal = e.results[i].isFinal;
    }
    if (isFinal) {
      handlers.onFinal(text.trim());
    } else {
      handlers.onInterim(text);
    }
  };
  rec.onerror = (e) => {
    const messages: Record<string, string> = {
      'not-allowed': 'Microphone access was blocked.',
      'no-speech': 'No speech was heard.',
      network:
        'Speech recognition is not available here. Use your system dictation instead.',
    };
    handlers.onError(messages[e.error] ?? `Speech recognition failed (${e.error}).`);
  };
  rec.onend = handlers.onEnd;
  rec.start();
  return { stop: () => rec.stop() };
};
