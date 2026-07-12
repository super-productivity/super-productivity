import Foundation

/// App-Group-UserDefaults-backed queue of pending done-state changes from
/// widget checkbox taps, stored as a JSON object string `{taskId:
/// targetIsDone}` — last tap per task wins, so tapping a task done and back to
/// undone before the app runs collapses into a single (or no-op) change.
/// Mirrors `WidgetDoneQueue.kt` semantics; a member of BOTH targets (the
/// intent writes, the widget peeks, the app's WidgetBridgePlugin drains).
///
/// Angular is the only consumer (via `WidgetBridge.getAndClearDoneQueue`) and
/// the only writer of the `widget_data` snapshot; the widget itself only ever
/// `peek()`s so pending taps render correctly without native code mutating the
/// blob. The serial queue gives in-process atomicity; cross-process safety
/// rests on UserDefaults being process-safe for a single-slot string, matching
/// the Android SharedPreferences approach.
enum DoneQueue {
    private static let serialQueue = DispatchQueue(
        label: "com.super-productivity.app.widget-done-queue"
    )

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: WidgetShared.appGroupId)
    }

    static func setTarget(taskId: String, isDone: Bool) {
        serialQueue.sync {
            guard let defaults else { return }
            var map = parse(defaults.string(forKey: WidgetShared.doneQueueKey)) ?? [:]
            map[taskId] = isDone
            if let data = try? JSONSerialization.data(withJSONObject: map),
               let json = String(data: data, encoding: .utf8) {
                defaults.set(json, forKey: WidgetShared.doneQueueKey)
            }
        }
    }

    /// Non-clearing read used to overlay pending done state at widget render time.
    static func peek() -> [String: Bool] {
        serialQueue.sync {
            parse(defaults?.string(forKey: WidgetShared.doneQueueKey)) ?? [:]
        }
    }

    /// - Returns: JSON object string `{taskId: targetIsDone}`, or nil if empty.
    static func getAndClear() -> String? {
        serialQueue.sync {
            guard let defaults else { return nil }
            let data = defaults.string(forKey: WidgetShared.doneQueueKey)
            if data != nil {
                defaults.removeObject(forKey: WidgetShared.doneQueueKey)
            }
            return data
        }
    }

    private static func parse(_ json: String?) -> [String: Bool]? {
        guard let json,
              let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return nil
        }
        var result: [String: Bool] = [:]
        for (taskId, target) in object {
            if let isDone = target as? Bool {
                result[taskId] = isDone
            }
        }
        return result
    }
}
