import { ReplaySubject, Subject } from 'rxjs';
import { App as CapacitorApp } from '@capacitor/app';
import { IS_IOS_NATIVE } from '../../util/is-native-platform';

export interface IosInterface {
  onPause$: Subject<void>;
  // ReplaySubject so a cold-start onResume emission arriving before the JS
  // subscriber attaches is still delivered. Mirrors androidInterface.
  onResume$: ReplaySubject<void>;
}

export const iosInterface: IosInterface = {
  onPause$: new Subject<void>(),
  onResume$: new ReplaySubject<void>(1),
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
