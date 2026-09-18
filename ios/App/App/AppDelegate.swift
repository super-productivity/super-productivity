import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    /// Handles a Home Screen quick action (long-press the app icon). The target
    /// URL is not mapped here — it is stored declaratively in each shortcut
    /// item's `UIApplicationShortcutItemUserInfo` in `Info.plist`, so this just
    /// opens it and the whole mapping lives in the shared URL-scheme parser
    /// (`src/app/core/app-uri-actions/parse-app-uri-quick-action.ts`).
    /// `tools/verify-ios-quick-actions.test.js` binds the two together.
    ///
    /// Reusing the URL scheme means quick actions ride the app's existing
    /// `appUrlOpen` pipeline instead of adding a second native channel.
    ///
    /// Why nothing is done in `didFinishLaunchingWithOptions`, even though a
    /// cold launch puts the item in its `launchOptions`: the proxy below posts
    /// `.capacitorOpenURL` synchronously and Foundation does not retain
    /// notifications, while the `App` plugin only registers its observer in
    /// `load()` — reached from `CapacitorBridge.init` → `registerPlugins()`,
    /// i.e. during the root view controller's `loadView()`, which runs *after*
    /// `didFinishLaunchingWithOptions` returns. Opening the URL there would
    /// post into the void. Letting that method return `true` instead makes iOS
    /// call this one once the launch sequence is done, which is past `loadView()`
    /// — so warm and cold launches share one path and need no queue. From here
    /// Capacitor's own `retainUntilConsumed: true` holds the event until the JS
    /// listener in `src/main.ts` registers.
    ///
    /// If this app ever opts into UIScene (no `UIApplicationSceneManifest`
    /// today), this moves to `windowScene(_:performActionFor:)`.
    func application(_ application: UIApplication,
                     performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        guard let raw = shortcutItem.userInfo?["url"] as? String,
              let url = URL(string: raw) else {
            // Only reachable if Info.plist and this file disagree.
            completionHandler(false)
            return
        }
        completionHandler(
            ApplicationDelegateProxy.shared.application(application, open: url, options: [:])
        )
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
