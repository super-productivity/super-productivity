import Foundation
import Capacitor
import WidgetKit

/// Bridges the Angular widget layer to the SupWidget WidgetKit extension.
///
/// The web side (`src/app/features/widget/widget-bridge.ts`) is the ONLY
/// writer of the `widget_data` blob; done-taps from the widget flow back the
/// other way through the DoneQueue. This mirrors the Android split between
/// `JavaScriptInterface.saveToDb`/`updateWidget` and `getWidgetDoneQueue`.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setWidgetData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readDoneQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledgeDoneQueue", returnType: CAPPluginReturnPromise)
    ]

    /// Persist the v:1 JSON snapshot to the shared App Group container and ask
    /// WidgetKit to re-render. The blob is opaque here — parsing/validation is
    /// the extension's job (unknown versions render as an empty widget).
    @objc func setWidgetData(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("Missing json parameter")
            return
        }
        guard let defaults = UserDefaults(suiteName: WidgetShared.appGroupId) else {
            call.reject("App Group \(WidgetShared.appGroupId) unavailable — check entitlements")
            return
        }
        defaults.set(json, forKey: WidgetShared.widgetDataKey)
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetShared.widgetKind)
        call.resolve()
    }

    /// Lease pending widget done targets without deleting them.
    @objc func readDoneQueue(_ call: CAPPluginCall) {
        do {
            if let lease = try DoneQueue.read() {
                call.resolve(["json": lease.targetsJson, "token": lease.token])
            } else {
                call.resolve(["json": NSNull(), "token": NSNull()])
            }
        } catch {
            call.reject("Failed to read widget done queue", nil, error)
        }
    }

    /// Acknowledge only entries whose unique revision still matches the lease.
    @objc func acknowledgeDoneQueue(_ call: CAPPluginCall) {
        guard let token = call.getString("token") else {
            call.reject("Missing token parameter")
            return
        }
        do {
            try DoneQueue.acknowledge(token)
            call.resolve()
        } catch {
            call.reject("Failed to acknowledge widget done queue", nil, error)
        }
    }
}
