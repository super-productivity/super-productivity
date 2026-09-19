import Capacitor

@objc(ShareInboxPlugin)
public class ShareInboxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareInboxPlugin"
    public let jsName = "ShareInbox"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledge", returnType: CAPPluginReturnPromise)
    ]

    @objc func getPending(_ call: CAPPluginCall) {
        do {
            let shares = try ShareInbox.pending().map {
                ["id": $0.id, "title": $0.title, "text": $0.text]
            }
            call.resolve(["shares": shares])
        } catch {
            call.reject("Could not read shared captures")
        }
    }

    @objc func acknowledge(_ call: CAPPluginCall) {
        do {
            try ShareInbox.acknowledge(id: call.getString("id") ?? "")
            call.resolve()
        } catch {
            call.reject("Could not acknowledge shared capture")
        }
    }
}
