import Capacitor
import UIKit
import UserNotifications

/// Sets the Home Screen app-icon badge to the due-task count from the web layer.
///
/// Uses `UNUserNotificationCenter.setBadgeCount` (available since iOS 16): unlike
/// the deprecated `applicationIconBadgeNumber`, clearing the badge does not
/// remove delivered notifications. The setting is opt-in and device-local, so
/// we never touch the icon unless a badge is showing or the user enabled it.
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
                // The web layer forwards a leading 0 on every launch; skip the
                // clear when nothing is showing so users who never enabled the
                // badge are left untouched.
                if UIApplication.shared.applicationIconBadgeNumber == 0 {
                    call.resolve()
                    return
                }
                self.setBadge(0, call)
                return
            }
            self.ensureBadgeAuthorizationThen {
                self.setBadge(count, call)
            }
        }
    }

    private func setBadge(_ count: Int, _ call: CAPPluginCall) {
        UNUserNotificationCenter.current().setBadgeCount(count) { _ in
            call.resolve()
        }
    }

    private func ensureBadgeAuthorizationThen(_ apply: @escaping () -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .notDetermined:
                // iOS shows its permission prompt only once, so request the same
                // set @capacitor/local-notifications uses; reminders then work too.
                center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
                    DispatchQueue.main.async(execute: apply)
                }
            default:
                // Denied: still try; the OS may ignore it.
                DispatchQueue.main.async(execute: apply)
            }
        }
    }
}
