// import { GlobalConfigState } from '../../features/config/global-config.model';
// import { fixNumberField } from './fix-number-field';
// import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
//
// export const repairGlobalConfig = (
//   globalConfig: GlobalConfigState,
// ): GlobalConfigState => {
//   // Helper function to fix a number field at a specific path
//   const fixNumberFieldInConfig = (obj: any, path: string[], defaultValue: number) => {
//     const lastKey = path[path.length - 1];
//     const parentObj =
//       path.length > 1 ? path.slice(0, -1).reduce((o, k) => o[k], obj) : obj;
//
//     if (typeof parentObj[lastKey] !== 'number') {
//       parentObj[lastKey] = fixNumberField(parentObj[lastKey], defaultValue);
//     }
//   };
//
//   // Fields to check with their paths and default values
//   const fieldsToFix = [
//     {
//       path: ['misc', 'firstDayOfWeek'],
//       defaultValue: DEFAULT_GLOBAL_CONFIG.misc.firstDayOfWeek,
//     },
//     {
//       path: ['misc', 'startOfNextDay'],
//       defaultValue: DEFAULT_GLOBAL_CONFIG.misc.startOfNextDay,
//     },
//     {
//       path: ['pomodoro', 'breakDuration'],
//       defaultValue: DEFAULT_GLOBAL_CONFIG.pomodoro.breakDuration,
//     },
//     {
//       path: ['pomodoro', 'cyclesBeforeLongerBreak'],
//       defaultValue: DEFAULT_GLOBAL_CONFIG.pomodoro.cyclesBeforeLongerBreak,
//     },
//   ];
//
//   // Apply fixes to all fields
//   fieldsToFix.forEach(({ path, defaultValue }) => {
//     fixNumberFieldInConfig(globalConfig, path, defaultValue);
//   });
//
//   return globalConfig as GlobalConfigState;
// };
