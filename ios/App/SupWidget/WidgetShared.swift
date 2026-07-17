import Foundation

/// Constants shared between the app target (`WidgetBridgePlugin`) and the
/// `SupWidget` extension — this file is a member of BOTH targets, so both
/// processes agree on where the widget data lives.
enum WidgetShared {
    /// App Group container shared by app and widget extension. Hard to change
    /// after ship: data already written would be stranded in the old container.
    static let appGroupId = "group.com.super-productivity.app"

    /// WidgetKind passed to `WidgetCenter.reloadTimelines(ofKind:)`.
    static let widgetKind = "SupTaskListWidget"

    /// Same key and JSON blob as the Android KeyValStore entry — the `v: 1`
    /// contract is defined in `src/app/features/widget/widget-data.model.ts`.
    static let widgetDataKey = "widget_data"

    static let doneQueueFileName = "widget-done-targets.json"
    static let doneQueueLockFileName = "widget-done-targets.lock"

    /// Parity with TaskListWidgetService.kt's MAX_TASKS.
    static let maxTasks = 20
}
