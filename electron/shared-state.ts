/**
 * Shared state module for Electron main process
 * Provides a single source of truth for application-wide flags
 */

let isQuiting = false;
let isLocked = false;
let isMinimizeToTray = false;
let isAlwaysOnTop = false;
let isTrayShowCurrentTask = false;
let isTrayShowCurrentCountdown = false;

export const getIsQuiting = (): boolean => isQuiting;

export const setIsQuiting = (value: boolean): void => {
  isQuiting = value;
};

export const getIsLocked = (): boolean => isLocked;

export const setIsLocked = (value: boolean): void => {
  isLocked = value;
};

export const getIsMinimizeToTray = (): boolean => isMinimizeToTray;

export const setIsMinimizeToTray = (value: boolean): void => {
  isMinimizeToTray = value;
};

export const getIsAlwaysOnTop = (): boolean => isAlwaysOnTop;

export const setIsAlwaysOnTop = (value: boolean): void => {
  isAlwaysOnTop = value;
};

export const getIsTrayShowCurrentTask = (): boolean => isTrayShowCurrentTask;

export const setIsTrayShowCurrentTask = (value: boolean): void => {
  isTrayShowCurrentTask = value;
};

export const getIsTrayShowCurrentCountdown = (): boolean => isTrayShowCurrentCountdown;

export const setIsTrayShowCurrentCountdown = (value: boolean): void => {
  isTrayShowCurrentCountdown = value;
};
