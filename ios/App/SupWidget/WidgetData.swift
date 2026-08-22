import Foundation

struct WidgetTask: Equatable {
    let id: String
    let title: String
    let isDone: Bool
    let projectColor: String?
}

struct WidgetSnapshot: Equatable {
    let tasks: [WidgetTask]
    let validUntil: Date?

    func isValid(at date: Date) -> Bool {
        validUntil.map { date < $0 } ?? false
    }
}

struct WidgetColor: Equatable {
    let red: Double
    let green: Double
    let blue: Double
    let alpha: Double

    static func parse(_ rawValue: String?) -> WidgetColor? {
        guard let rawValue else { return nil }
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if value.hasPrefix("#") {
            return parseHex(String(value.dropFirst()))
        }
        if value.hasPrefix("rgb(") && value.hasSuffix(")") {
            return parseRgb(String(value.dropFirst(4).dropLast()), includesAlpha: false)
        }
        if value.hasPrefix("rgba(") && value.hasSuffix(")") {
            return parseRgb(String(value.dropFirst(5).dropLast()), includesAlpha: true)
        }
        return nil
    }

    private static func parseHex(_ digits: String) -> WidgetColor? {
        var value: UInt64 = 0
        let scanner = Scanner(string: digits)
        guard scanner.scanHexInt64(&value), scanner.isAtEnd else { return nil }
        switch digits.count {
        case 3:
            return WidgetColor(
                red: Double((value >> 8) & 0xF) / 15,
                green: Double((value >> 4) & 0xF) / 15,
                blue: Double(value & 0xF) / 15,
                alpha: 1
            )
        case 6:
            return WidgetColor(
                red: Double((value >> 16) & 0xFF) / 255,
                green: Double((value >> 8) & 0xFF) / 255,
                blue: Double(value & 0xFF) / 255,
                alpha: 1
            )
        case 8:
            return WidgetColor(
                red: Double((value >> 16) & 0xFF) / 255,
                green: Double((value >> 8) & 0xFF) / 255,
                blue: Double(value & 0xFF) / 255,
                alpha: Double((value >> 24) & 0xFF) / 255
            )
        default:
            return nil
        }
    }

    private static func parseRgb(_ components: String, includesAlpha: Bool) -> WidgetColor? {
        let values = components.split(separator: ",", omittingEmptySubsequences: false).map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard values.count == (includesAlpha ? 4 : 3),
              let red = Int(values[0]), (0...255).contains(red),
              let green = Int(values[1]), (0...255).contains(green),
              let blue = Int(values[2]), (0...255).contains(blue)
        else {
            return nil
        }
        let alpha: Double
        if includesAlpha {
            guard let parsedAlpha = Double(values[3]), (0...1).contains(parsedAlpha) else {
                return nil
            }
            alpha = parsedAlpha
        } else {
            alpha = 1
        }
        return WidgetColor(
            red: Double(red) / 255,
            green: Double(green) / 255,
            blue: Double(blue) / 255,
            alpha: alpha
        )
    }
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
        parseSnapshot(json, pendingDoneTargets: pendingDoneTargets).tasks
    }

    static func parseSnapshot(
        _ json: String,
        pendingDoneTargets: [String: Bool] = [:]
    ) -> WidgetSnapshot {
        guard let data = json.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              root["v"] as? Int == supportedVersion,
              let tasksArray = root["tasks"] as? [[String: Any]]
        else {
            return WidgetSnapshot(tasks: [], validUntil: nil)
        }
        let validUntil = (root["validUntil"] as? NSNumber).flatMap { milliseconds in
            let seconds = milliseconds.doubleValue / 1_000
            return seconds.isFinite ? Date(timeIntervalSince1970: seconds) : nil
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
                return WidgetSnapshot(tasks: [], validUntil: nil)
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
        return WidgetSnapshot(tasks: result, validUntil: validUntil)
    }
}
