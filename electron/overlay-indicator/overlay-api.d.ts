interface OverlayContentData {
  title: string;
  time: string;
  mode: 'pomodoro' | 'focus' | 'task' | 'idle';
}

interface OverlayAPI {
  showMainWindow: () => void;
  onUpdateContent: (callback: (data: OverlayContentData) => void) => () => void;
  onUpdateOpacity: (callback: (opacity: number) => void) => () => void;
}

declare global {
  interface Window {
    overlayAPI: OverlayAPI;
  }
}

export {};
