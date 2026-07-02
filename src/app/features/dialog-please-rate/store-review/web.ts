import { WebPlugin } from '@capacitor/core';
import type { StoreReviewPlugin } from './definitions';

export class StoreReviewWeb extends WebPlugin implements StoreReviewPlugin {
  async requestReview(): Promise<void> {
    // No native review UI on web/electron. The caller only invokes this on iOS
    // native; this stub keeps the plugin contract satisfied everywhere else.
  }
}
