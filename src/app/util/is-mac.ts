export let IS_MAC = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

export const setIsMacForTesting = (v: boolean): void => {
  IS_MAC = v;
};
