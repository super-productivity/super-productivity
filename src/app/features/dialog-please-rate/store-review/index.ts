import { registerPlugin } from '@capacitor/core';
import type { StoreReviewPlugin } from './definitions';

const StoreReview = registerPlugin<StoreReviewPlugin>('StoreReview', {
  web: () => import('./web').then((m) => new m.StoreReviewWeb()),
});

export * from './definitions';
export { StoreReview };
