import AppIntents

/// Interactive-widget intent behind each task row's checkbox. It ONLY writes
/// the done queue (single-writer invariant: Angular owns the `widget_data`
/// blob); WidgetKit re-renders the widget automatically after the intent, and
/// the timeline provider overlays the pending target so the checkbox flips
/// immediately. The queued change is applied in the app on next resume.
struct ToggleDoneIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle task done"
    // widget-internal plumbing, not useful from Shortcuts/Spotlight
    static var isDiscoverable: Bool = false

    @Parameter(title: "Task ID")
    var taskId: String

    /// Target state computed at render time from the DISPLAYED state, so
    /// repeated taps toggle back and forth (last-wins in the queue).
    @Parameter(title: "Set done")
    var setDone: Bool

    init() {}

    init(taskId: String, setDone: Bool) {
        self.taskId = taskId
        self.setDone = setDone
    }

    func perform() async throws -> some IntentResult {
        try DoneQueue.setTarget(taskId: taskId, isDone: setDone)
        return .result()
    }
}
