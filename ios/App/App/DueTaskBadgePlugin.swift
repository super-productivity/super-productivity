import Capacitor
import UIKit
import UserNotifications

/// Sets the Home Screen app-icon badge to the due-task count from the web layer.
///
/// Modern iOS needs notification authorization (at least `.badge`) for the
/// number to stick; clearing to zero is always attempted. The shared setting
/// `isShowDueTaskBadge` stays off by default so we never touch the icon until
/// the user opts in (#6707; Android follows via #11147).
@objc(DueTaskBadgePlugin)
public class DueTaskBadgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DueTaskBadgePlugin"
    public let jsName = "DueTaskBadge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setCount", returnType: CAPPluginReturnPromise)
    ]

    @objc func setCount(_ call: CAPPluginCall) {
        let count = max(0, call.getInt("count") ?? 0)
        DispatchQueue.main.async {
            if count == 0 {
                UIApplication.shared.applicationIconBadgeNumber = 0
                call.resolve()
                return
            }
            self.ensureBadgeAuthorizationThen {
                UIApplication.shared.applicationIconBadgeNumber = count
                call.resolve()
            }
        }
    }

    private func ensureBadgeAuthorizationThen(_ apply: @escaping () -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                DispatchQueue.main.async(execute: apply)
            case .notDetermined:
                center.requestAuthorization(options: [.badge]) { _, _ in
                    DispatchQueue.main.async(execute: apply)
                }
            default:
                // Denied: still try; the OS may ignore it.
                DispatchQueue.main.async(execute: apply)
            }
        }
    }
}
