import XCTest

/// Launches the app and taps "Allow" on the notification permission alert.
/// The alert belongs to SpringBoard, so nothing inside the web view can
/// answer it, and `simctl privacy` has no notification service.
final class AllowTap: XCTestCase {
    func testAllowNotifications() {
        XCUIApplication(bundleIdentifier: "com.super-productivity.app").launch()

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons["Allow"]
        // A debug web bundle on a CI Simulator can take minutes to boot.
        XCTAssertTrue(
            allow.waitForExistence(timeout: 300),
            "the notification permission alert did not appear"
        )
        allow.tap()

        // Let the web layer see the grant and write its report before the
        // test runner exits.
        sleep(10)
    }
}
