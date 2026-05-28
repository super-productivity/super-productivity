import { Subject } from 'rxjs';
import { App as CapacitorApp } from '@capacitor/app';
import { IS_IOS_NATIVE } from '../../util/is-native-platform';

export interface IosInterface {
  onResume$: Subject<void>;
}

// Plain Subject (not ReplaySubject): unlike androidInterface, the producer is a
// JS appStateChange listener registered at app bootstrap, so a resume can never
// be delivered before the effect has subscribed. Pause persistence is handled
// in main.ts inside the BackgroundTask.beforeExit budget, not here.
export const iosInterface: IosInterface = {
  onResume$: new Subject<void>(),
};

if (IS_IOS_NATIVE) {
  CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) {
      iosInterface.onResume$.next();
    }
  });
}
