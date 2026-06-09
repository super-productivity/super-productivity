import { SnackType, PluginMessageType } from './types';

// Plugin message interfaces
interface PluginMessage {
  type: PluginMessageType;
  [key: string]: any;
}

interface AddStrategyTaskMessage extends PluginMessage {
  type: PluginMessageType.ADD_STRATEGY_TASK;
  strategy: string;
  blockerType: string;
}

interface StartPomodoroMessage extends PluginMessage {
  type: PluginMessageType.START_POMODORO;
}

interface StartFocusModeMessage extends PluginMessage {
  type: PluginMessageType.START_FOCUS_MODE;
}

interface QuickAddTaskMessage extends PluginMessage {
  type: PluginMessageType.QUICK_ADD_TASK;
}

type AllPluginMessages =
  | AddStrategyTaskMessage
  | StartPomodoroMessage
  | StartFocusModeMessage
  | QuickAddTaskMessage;

// Window interface augmentation
declare global {
  interface Window {
    PluginAPI?: {
      showSnack: (config: { msg: string; type?: SnackType }) => void;
      openDialog: (config: any) => Promise<string | undefined>;
      onMessage: (handler: (message: AllPluginMessages) => Promise<any>) => void;
      addTask: (task: { title: string; notes?: string }) => Promise<string>;
      dispatchAction: (action: { type: string; [key: string]: any }) => void;
    };
    __pluginMessageHandler?: (message: AllPluginMessages) => Promise<any>;
  }
}

export {};
