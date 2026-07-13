import XCTest

/// Locks the Swift end of the `widget_data` v:1 contract with the SAME golden
/// blob as the Kotlin `WidgetDataTest.kt` and the writer-side
/// `widget.selectors.spec.ts` — if one changes, the others must too.
///
final class WidgetDataTests: XCTestCase {

    private let blob = """
        {
          "v": 1,
          "tasks": [
            {"id": "t1", "title": "Task one", "isDone": false, "projectId": "p1"},
            {"id": "t2", "title": "Task two", "isDone": true},
            {"id": "t3", "title": "Task three", "isDone": false, "projectId": null}
          ],
          "projectColors": {"p1": "#ff0000"},
          "validUntil": 1783980000000
        }
        """

    func testParsesTasksWithProjectColors() {
        let tasks = WidgetData.parse(blob)
        XCTAssertEqual(tasks.count, 3)
        XCTAssertEqual(
            tasks[0],
            WidgetTask(id: "t1", title: "Task one", isDone: false, projectColor: "#ff0000")
        )
        XCTAssertEqual(
            tasks[1],
            WidgetTask(id: "t2", title: "Task two", isDone: true, projectColor: nil)
        )
    }

    func testJsonNullProjectIdDoesNotBecomeStringNull() {
        let tasks = WidgetData.parse(blob)
        XCTAssertNil(tasks[2].projectColor)
    }

    func testOverlaysPendingDoneTargets() {
        let tasks = WidgetData.parse(blob, pendingDoneTargets: ["t1": true])
        XCTAssertTrue(tasks[0].isDone)
        XCTAssertTrue(tasks[1].isDone)
        XCTAssertFalse(tasks[2].isDone)
    }

    func testOverlaysPendingUndoneTargets() {
        // t2 is done in the blob but has a pending "mark undone" tap
        let tasks = WidgetData.parse(blob, pendingDoneTargets: ["t2": false])
        XCTAssertFalse(tasks[1].isDone)
    }

    func testUnknownVersionParsesToEmpty() {
        XCTAssertTrue(WidgetData.parse(#"{"v": 2, "tasks": [{"id": "x"}]}"#).isEmpty)
        XCTAssertTrue(WidgetData.parse(#"{"tasks": []}"#).isEmpty)
    }

    func testEmptyBlobParsesToEmpty() {
        XCTAssertTrue(WidgetData.parse("{}").isEmpty)
        XCTAssertTrue(WidgetData.parse(#"{"v": 1}"#).isEmpty)
    }

    func testMissingColorFallsBackToNil() {
        let json =
            #"{"v":1,"tasks":[{"id":"a","title":"A","isDone":false,"projectId":"px"}],"projectColors":{}}"#
        XCTAssertNil(WidgetData.parse(json)[0].projectColor)
    }

    func testMalformedTaskFailsWholeBlobLikeKotlin() {
        // Kotlin's getString throws on a missing id/title, failing the whole
        // blob to an empty widget — the Swift parser must match.
        let json = #"{"v":1,"tasks":[{"title":"no id"}],"projectColors":{}}"#
        XCTAssertTrue(WidgetData.parse(json).isEmpty)
    }

    func testParsesOptionalSnapshotExpiry() throws {
        let snapshot = WidgetData.parseSnapshot(blob)

        let validUntil = try XCTUnwrap(snapshot.validUntil)
        XCTAssertEqual(validUntil.timeIntervalSince1970 * 1_000, 1_783_980_000_000)
        XCTAssertTrue(snapshot.isValid(at: validUntil.addingTimeInterval(-1)))
        XCTAssertFalse(snapshot.isValid(at: validUntil))
    }

    func testBlobWithoutExpiryIsHiddenRatherThanRemainingStaleForever() {
        let snapshot = WidgetData.parseSnapshot(#"{"v":1,"tasks":[],"projectColors":{}}"#)

        XCTAssertNil(snapshot.validUntil)
        XCTAssertFalse(snapshot.isValid(at: Date.distantPast))
    }

    func testParsesHexAndCssRgbProjectColors() {
        XCTAssertEqual(
            WidgetColor.parse("#8b4a9d"),
            WidgetColor(
                red: 139.0 / 255.0,
                green: 74.0 / 255.0,
                blue: 157.0 / 255.0,
                alpha: 1
            )
        )
        XCTAssertEqual(
            WidgetColor.parse("rgb(144, 187, 165)"),
            WidgetColor(
                red: 144.0 / 255.0,
                green: 187.0 / 255.0,
                blue: 165.0 / 255.0,
                alpha: 1
            )
        )
        XCTAssertEqual(
            WidgetColor.parse("rgba(144, 187, 165, 0.5)"),
            WidgetColor(
                red: 144.0 / 255.0,
                green: 187.0 / 255.0,
                blue: 165.0 / 255.0,
                alpha: 0.5
            )
        )
        XCTAssertNil(WidgetColor.parse("rgb(300, 0, 0)"))
        XCTAssertNil(WidgetColor.parse("rgb(1, , 3)"))
        XCTAssertNil(WidgetColor.parse("#ff000g"))
    }
}

final class DoneQueueStoreTests: XCTestCase {
    private var containerURL: URL!
    private var store: DoneQueueStore!

    override func setUpWithError() throws {
        containerURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: containerURL,
            withIntermediateDirectories: true
        )
        store = DoneQueueStore(containerURL: containerURL)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: containerURL)
        store = nil
        containerURL = nil
    }

    func testAcknowledgementRemovesOnlyUnchangedLeasedTargets() throws {
        try store.setTarget(taskId: "a", isDone: true)
        try store.setTarget(taskId: "b", isDone: false)
        let lease = try XCTUnwrap(store.read())

        try store.setTarget(taskId: "a", isDone: false)
        try store.setTarget(taskId: "c", isDone: true)
        try store.acknowledge(lease.token)

        XCTAssertEqual(try store.peek(), ["a": false, "c": true])
    }

    func testAcknowledgementRemovesTargetsThatStillMatchTheLease() throws {
        try store.setTarget(taskId: "a", isDone: true)
        let lease = try XCTUnwrap(store.read())

        try store.acknowledge(lease.token)

        XCTAssertNil(try store.read())
        XCTAssertEqual(try store.peek(), [:])
    }

    func testAcknowledgementPreservesAnABASequenceWithTheSameFinalTarget() throws {
        try store.setTarget(taskId: "a", isDone: true)
        let lease = try XCTUnwrap(store.read())

        try store.setTarget(taskId: "a", isDone: false)
        try store.setTarget(taskId: "a", isDone: true)
        try store.acknowledge(lease.token)

        XCTAssertEqual(try store.peek(), ["a": true])
    }

    func testConcurrentWritersDoNotLoseDistinctTargets() {
        let firstStore = DoneQueueStore(containerURL: containerURL)
        let secondStore = DoneQueueStore(containerURL: containerURL)

        DispatchQueue.concurrentPerform(iterations: 100) { index in
            let targetStore = index.isMultiple(of: 2) ? firstStore : secondStore
            try! targetStore.setTarget(taskId: "task-\(index)", isDone: true)
        }

        XCTAssertEqual(try! store.peek().count, 100)
    }
}
