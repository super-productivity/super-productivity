#import <Capacitor/Capacitor.h>

CAP_PLUGIN(StoreReviewPlugin, "StoreReview",
    CAP_PLUGIN_METHOD(requestReview, CAPPluginReturnPromise);
)
