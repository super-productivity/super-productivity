import { Subject } from 'rxjs';
import { App as CapacitorApp } from '@capacitor/app';
import { IS_IOS_NATIVE } from '../../util/is-native-platform';

export interface IosInterface {
  onResume$: Subject<void>;
  onPause$: Subject<void>;
}

// Plain Subjects (not ReplaySubjects): unlike androidInterface, the producer is
// a JS appStateChange listener registered at app bootstrap, so a resume/pause
// can never be delivered before the effects have subscribed. Note that
// appStateChange only fires on transitions — there is no emission at cold
// start. Pause-time persistence is handled in main.ts inside the
// BackgroundTask.beforeExit budget, not here; onPause$ only feeds fast,
// non-critical side effects like the widget snapshot push.
export const iosInterface: IosInterface = {
  onResume$: new Subject<void>(),
  onPause$: new Subject<void>(),
};

if (IS_IOS_NATIVE) {
  CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) {
      iosInterface.onResume$.next();
    } else {
      iosInterface.onPause$.next();
    }
  });
}
