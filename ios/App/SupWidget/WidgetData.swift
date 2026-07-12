import Foundation

struct WidgetTask: Equatable {
    let id: String
    let title: String
    let isDone: Bool
    let projectColor: String?
}

/// Native end of the `widget_data` App Group blob contract. The writer is
/// Angular's WidgetDataService; the blob shape is defined by `WidgetData` in
/// `src/app/features/widget/widget-data.model.ts` and also consumed by the
/// Android `WidgetData.kt` — keep all ends in sync and bump `v` on breaking
/// changes.
enum WidgetData {
    static let supportedVersion = 1

    /// - Parameter pendingDoneTargets: per-task done-state targets queued via
    ///   `DoneQueue` but not yet applied by Angular — overlaid so a checkbox
    ///   tap is reflected immediately even while the app process is suspended.
    static func parse(
        _ json: String,
        pendingDoneTargets: [String: Bool] = [:]
    ) -> [WidgetTask] {
        guard let data = json.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              root["v"] as? Int == supportedVersion,
              let tasksArray = root["tasks"] as? [[String: Any]]
        else {
            return []
        }
        let projectColors = root["projectColors"] as? [String: Any]
        var result: [WidgetTask] = []
        for task in tasksArray {
            // id/title are required — like the Kotlin parser (where getString
            // throws), a malformed task fails the whole blob to an empty
            // widget instead of rendering partial garbage
            guard let id = task["id"] as? String,
                  let title = task["title"] as? String
            else {
                return []
            }
            // `as? String` is nil for JSON null (NSNull), which covers the
            // Kotlin parser's explicit isNull guards for free
            let projectId = task["projectId"] as? String
            let color = projectId.flatMap { projectColors?[$0] as? String }
            result.append(
                WidgetTask(
                    id: id,
                    title: title,
                    isDone: pendingDoneTargets[id] ?? (task["isDone"] as? Bool ?? false),
                    projectColor: color
                )
            )
        }
        return result
    }
}
