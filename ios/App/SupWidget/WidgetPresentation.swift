import Foundation

enum WidgetLayout {
    /// Apple's minimum hit target for dense controls. Widget rows cannot fit
    /// the preferred 44-point target without hiding nearly all useful content.
    static let taskToggleHitTarget: CGFloat = 28
}

/// Native widget strings generated from the canonical English translation
/// source. `Bundle.main` is the widget extension at runtime; tests inject their
/// own bundle to verify the generated resource is included.
enum WidgetStrings {
    static var today: String {
        localized("WIDGET.IOS.TODAY")
    }

    static var empty: String {
        localized("WIDGET.IOS.EMPTY")
    }

    static var expired: String {
        localized("WIDGET.IOS.EXPIRED")
    }

    static var placeholderPlanDay: String {
        localized("WIDGET.IOS.PLACEHOLDER_PLAN_DAY")
    }

    static var placeholderDeepWork: String {
        localized("WIDGET.IOS.PLACEHOLDER_DEEP_WORK")
    }

    static var placeholderInboxReview: String {
        localized("WIDGET.IOS.PLACEHOLDER_INBOX_REVIEW")
    }

    static func more(_ count: Int, bundle: Bundle = .main) -> String {
        formatted(
            "WIDGET.IOS.MORE",
            bundle: bundle,
            argument: String(count)
        )
    }

    static func markDone(_ title: String, bundle: Bundle = .main) -> String {
        formatted(
            "WIDGET.IOS.MARK_DONE",
            bundle: bundle,
            argument: title
        )
    }

    static func markUndone(_ title: String, bundle: Bundle = .main) -> String {
        formatted(
            "WIDGET.IOS.MARK_UNDONE",
            bundle: bundle,
            argument: title
        )
    }

    static func localized(_ key: String, bundle: Bundle = .main) -> String {
        bundle.localizedString(forKey: key, value: nil, table: nil)
    }

    private static func formatted(
        _ key: String,
        bundle: Bundle,
        argument: String
    ) -> String {
        localized(key, bundle: bundle).replacingOccurrences(
            of: "%@",
            with: argument
        )
    }
}
