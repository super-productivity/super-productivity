#import <Capacitor/Capacitor.h>

CAP_PLUGIN(WidgetBridgePlugin, "WidgetBridge",
    CAP_PLUGIN_METHOD(setWidgetData, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(readDoneQueue, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(acknowledgeDoneQueue, CAPPluginReturnPromise);
)
