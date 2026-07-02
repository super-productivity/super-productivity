import Foundation
import Capacitor
import StoreKit
import UIKit

/// Bridges the native App Store review prompt to the web layer.
///
/// The web rating flow calls `StoreReview.requestReview()` on iOS instead of
/// opening a custom dialog. Per App Store policy the system fully controls the
/// prompt: it may not appear at all, is rate-limited (max ~3 / 365 days), and
/// returns no result — so `requestReview` simply asks and resolves.
@objc(StoreReviewPlugin)
public class StoreReviewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreReviewPlugin"
    public let jsName = "StoreReview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise)
    ]

    @objc func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let scene = self.resolveWindowScene() else {
                call.reject("No active window scene for review prompt")
                return
            }
            // Deprecated in iOS 18 in favor of AppStore.requestReview(in:), but
            // still functional and the widely-compatible call for our iOS 16
            // deployment target. Deprecation is a warning, not a build error.
            SKStoreReviewController.requestReview(in: scene)
            call.resolve()
        }
    }

    private func resolveWindowScene() -> UIWindowScene? {
        if let scene = self.bridge?.viewController?.view.window?.windowScene {
            return scene
        }
        let scenes = UIApplication.shared.connectedScenes
        return (scenes.first(where: { $0.activationState == .foregroundActive })
            ?? scenes.first) as? UIWindowScene
    }
}
