import { registerPlugin } from '@capacitor/core';
import type { WebDavHttpPlugin } from './definitions';

const WebDavHttp = registerPlugin<WebDavHttpPlugin>('WebDavHttp', {
  web: () => import('./web').then((m) => new m.WebDavHttpWeb()),
});

export * from './definitions';
export { WebDavHttp };
