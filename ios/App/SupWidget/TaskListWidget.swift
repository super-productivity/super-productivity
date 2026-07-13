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
    let totalTaskCount: Int
    let validUntil: Date?
    let isExpired: Bool
}

struct TaskListProvider: TimelineProvider {
    func placeholder(in context: Context) -> TaskListEntry {
        TaskListEntry(
            date: Date(),
            tasks: [
                WidgetTask(id: "ph-1", title: "Plan the day", isDone: false, projectColor: nil),
                WidgetTask(id: "ph-2", title: "Deep work block", isDone: false, projectColor: nil),
                WidgetTask(id: "ph-3", title: "Inbox review", isDone: true, projectColor: nil),
            ],
            totalTaskCount: 3,
            validUntil: nil,
            isExpired: false
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (TaskListEntry) -> Void) {
        completion(loadEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TaskListEntry>) -> Void) {
        let entry = loadEntry()
        var entries = [entry]
        let policy: TimelineReloadPolicy
        if let validUntil = entry.validUntil, validUntil > entry.date {
            // WidgetKit may delay the requested reload. Supplying the boundary
            // entry guarantees yesterday's tasks disappear on time even when
            // the provider is not called again immediately.
            entries.append(
                TaskListEntry(
                    date: validUntil,
                    tasks: [],
                    totalTaskCount: 0,
                    validUntil: nil,
                    isExpired: true
                )
            )
            policy = .after(validUntil)
        } else {
            policy = .never
        }
        completion(Timeline(entries: entries, policy: policy))
    }

    private func loadEntry(at now: Date = Date()) -> TaskListEntry {
        let json = UserDefaults(suiteName: WidgetShared.appGroupId)?
            .string(forKey: WidgetShared.widgetDataKey) ?? "{}"
        let snapshot = WidgetData.parseSnapshot(json, pendingDoneTargets: DoneQueue.peek())
        let isExpired = !snapshot.isValid(at: now)
        let tasks = isExpired ? [] : snapshot.tasks
        return TaskListEntry(
            date: now,
            tasks: Array(tasks.prefix(WidgetShared.maxTasks)),
            totalTaskCount: tasks.count,
            validUntil: snapshot.validUntil,
            isExpired: isExpired
        )
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
                Text(
                    entry.isExpired
                        ? "Open Super Productivity to refresh"
                        : "No tasks for today"
                )
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
            if entry.totalTaskCount > maxRows {
                Text("+\(entry.totalTaskCount - maxRows) more")
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
            .accessibilityLabel(
                task.isDone ? "Mark \(task.title) as not done" : "Mark \(task.title) as done"
            )

            // Project dot: tinted with the project color, hidden entirely for
            // project-less tasks instead of showing a meaningless default.
            if let color = WidgetColor.parse(task.projectColor) {
                Circle()
                    .fill(
                        Color(red: color.red, green: color.green, blue: color.blue)
                            .opacity(color.alpha)
                    )
                    .frame(width: 8, height: 8)
            }

            Text(task.title)
                .font(.system(size: 14))
                .foregroundStyle(task.isDone ? WidgetStyle.inkMuted : WidgetStyle.ink)
                .lineLimit(1)

            Spacer(minLength: 0)
        }
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
