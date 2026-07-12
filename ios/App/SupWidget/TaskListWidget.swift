import SwiftUI
import WidgetKit

// Static styling matching the Android v1 widget (res/values/colors.xml):
// widget_bg #F5F8F8F7, widget_ink #DE000000, widget_ink_muted #8A000000,
// widget_separator #1F000000, widget_brand #8B4A9D.
private enum WidgetStyle {
    static let bg = Color(red: 0xF8 / 255, green: 0xF8 / 255, blue: 0xF7 / 255)
        .opacity(0xF5 / 255)
    static let ink = Color.black.opacity(0xDE / 255)
    static let inkMuted = Color.black.opacity(0x8A / 255)
    static let separator = Color.black.opacity(0x1F / 255)
    static let brand = Color(red: 0x8B / 255, green: 0x4A / 255, blue: 0x9D / 255)
}

struct TaskListEntry: TimelineEntry {
    let date: Date
    let tasks: [WidgetTask]
}

struct TaskListProvider: TimelineProvider {
    func placeholder(in context: Context) -> TaskListEntry {
        TaskListEntry(
            date: Date(),
            tasks: [
                WidgetTask(id: "ph-1", title: "Plan the day", isDone: false, projectColor: nil),
                WidgetTask(id: "ph-2", title: "Deep work block", isDone: false, projectColor: nil),
                WidgetTask(id: "ph-3", title: "Inbox review", isDone: true, projectColor: nil),
            ]
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (TaskListEntry) -> Void) {
        completion(loadEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TaskListEntry>) -> Void) {
        // Single entry that never expires: every refresh is an explicit
        // reloadTimelines push — from the app after a snapshot write, or the
        // automatic re-render after ToggleDoneIntent. No polling.
        completion(Timeline(entries: [loadEntry()], policy: .never))
    }

    private func loadEntry() -> TaskListEntry {
        let json = UserDefaults(suiteName: WidgetShared.appGroupId)?
            .string(forKey: WidgetShared.widgetDataKey) ?? "{}"
        let tasks = WidgetData.parse(json, pendingDoneTargets: DoneQueue.peek())
        return TaskListEntry(date: Date(), tasks: Array(tasks.prefix(WidgetShared.maxTasks)))
    }
}

struct TaskListWidgetView: View {
    @Environment(\.widgetFamily) private var family

    let entry: TaskListEntry

    // Unlike the Android ListView the widget cannot scroll; cap rows to what
    // the family fits and summarize the rest as "+N more".
    private var maxRows: Int {
        family == .systemLarge ? 9 : 3
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            header
            Rectangle()
                .fill(WidgetStyle.separator)
                .frame(height: 1)
            if entry.tasks.isEmpty {
                emptyState
            } else {
                taskList
            }
        }
        .containerBackground(for: .widget) { WidgetStyle.bg }
        // Tap anywhere outside a checkbox opens the app (no per-task
        // navigation, matching Android v1).
        .widgetURL(URL(string: "com.super-productivity.app://widget"))
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(WidgetStyle.brand)
            Text("Today")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(WidgetStyle.ink)
            Spacer()
        }
    }

    private var emptyState: some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                Text("No tasks for today")
                    .font(.system(size: 14))
                    .foregroundStyle(WidgetStyle.inkMuted)
                Spacer()
            }
            Spacer()
        }
    }

    private var taskList: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(entry.tasks.prefix(maxRows), id: \.id) { task in
                TaskRowView(task: task)
            }
            if entry.tasks.count > maxRows {
                Text("+\(entry.tasks.count - maxRows) more")
                    .font(.system(size: 12))
                    .foregroundStyle(WidgetStyle.inkMuted)
                    .padding(.leading, 30)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct TaskRowView: View {
    let task: WidgetTask

    var body: some View {
        HStack(spacing: 8) {
            // Checkbox toggles to the opposite of the DISPLAYED state (which
            // already includes the pending-done overlay).
            Button(intent: ToggleDoneIntent(taskId: task.id, setDone: !task.isDone)) {
                Image(systemName: task.isDone ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 18))
                    .foregroundStyle(task.isDone ? WidgetStyle.brand : WidgetStyle.inkMuted)
            }
            .buttonStyle(.plain)

            // Project dot: tinted with the project color, hidden entirely for
            // project-less tasks instead of showing a meaningless default.
            if let color = parseHexColor(task.projectColor) {
                Circle()
                    .fill(color)
                    .frame(width: 8, height: 8)
            }

            Text(task.title)
                .font(.system(size: 14))
                .foregroundStyle(task.isDone ? WidgetStyle.inkMuted : WidgetStyle.ink)
                .lineLimit(1)

            Spacer(minLength: 0)
        }
    }

    /// Accepts #RGB / #RRGGBB / #AARRGGBB like Android's Color.parseColor;
    /// returns nil for anything unparsable (dot is hidden then).
    private func parseHexColor(_ hex: String?) -> Color? {
        guard let hex, hex.hasPrefix("#") else { return nil }
        var value: UInt64 = 0
        let digits = String(hex.dropFirst())
        guard Scanner(string: digits).scanHexInt64(&value) else { return nil }
        let r: Double
        let g: Double
        let b: Double
        var a: Double = 1
        switch digits.count {
        case 3:
            r = Double((value >> 8) & 0xF) / 15
            g = Double((value >> 4) & 0xF) / 15
            b = Double(value & 0xF) / 15
        case 6:
            r = Double((value >> 16) & 0xFF) / 255
            g = Double((value >> 8) & 0xFF) / 255
            b = Double(value & 0xFF) / 255
        case 8:
            a = Double((value >> 24) & 0xFF) / 255
            r = Double((value >> 16) & 0xFF) / 255
            g = Double((value >> 8) & 0xFF) / 255
            b = Double(value & 0xFF) / 255
        default:
            return nil
        }
        return Color(red: r, green: g, blue: b).opacity(a)
    }
}

struct TaskListWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: WidgetShared.widgetKind,
            provider: TaskListProvider()
        ) { entry in
            TaskListWidgetView(entry: entry)
        }
        .configurationDisplayName("Today's Tasks")
        .description("Shows today's tasks with quick done action")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

@main
struct SupWidgetBundle: WidgetBundle {
    var body: some Widget {
        TaskListWidget()
    }
}
