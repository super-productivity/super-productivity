#import <Capacitor/Capacitor.h>

CAP_PLUGIN(WebDavHttpPlugin, "WebDavHttp",
    CAP_PLUGIN_METHOD(request, CAPPluginReturnPromise);
)
