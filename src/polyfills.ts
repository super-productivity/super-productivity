/**
 * This file includes polyfills needed by Angular and is loaded before the app.
 * You can add your own extra polyfills to this file.
 *
 * This file is divided into 2 sections:
 *   1. Browser polyfills. These are applied before loading Angular and are sorted by browsers.
 *   2. Application imports. Files imported after Angular that should be loaded before your main
 *      file.
 *
 * The current setup is for so-called "evergreen" browsers; the last versions of browsers that
 * automatically update themselves. This includes Safari >= 10, Chrome >= 55 (including Opera),
 * Edge >= 13 on the desktop, and iOS 10 and Chrome on mobile.
 *
 * Learn more in https://angular.io/docs/ts/latest/guide/browser-support.html
 */

/***************************************************************************************************
 * BROWSER POLYFILLS
 */

/* IE9, IE10 and IE11 requires all of the following polyfills. **/
//import 'core-js/es/symbol';
// core-js/es/object removed: Object.fromEntries is supported since Chrome 73+ (2019).
// Android 9 (Chrome 69) is EOL and no longer targeted.
/*import 'core-js/es/function';
import 'core-js/es/parse-int';
import 'core-js/es/parse-float';
import 'core-js/es/number';
import 'core-js/es/math';
import 'core-js/es/string';
import 'core-js/es/date';
import 'core-js/es/array';
import 'core-js/es/regexp';
import 'core-js/es/map';
import 'core-js/es/weak-map';
import 'core-js/es/set';*/
/* Evergreen browsers require these. **/
// Used for reflect-metadata in JIT. If you use AOT (and only Angular decorators), you can remove.
// import 'core-js/es/reflect';
/***************************************************************************************************
 * Zone JS is no longer required as we're using zoneless change detection.
 */

/** IE10 and IE11 requires the following for the Reflect API. */
// import 'core-js/es/reflect';

/***************************************************************************************************
 * APPLICATION IMPORTS
 */

import './app/rxjs-to-promise.polyfill';

// fix ical.js
// @see https://github.com/mozilla-comm/ical.js/issues/329
(window as any).ICAL = {};
(window as any).global = window;
