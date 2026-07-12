import XCTest

/// Locks the Swift end of the `widget_data` v:1 contract with the SAME golden
/// blob as the Kotlin `WidgetDataTest.kt` and the writer-side
/// `widget.selectors.spec.ts` — if one changes, the others must too.
///
/// NOTE: not yet wired to an Xcode test target (the project has no iOS test
/// infrastructure at all so far). To run: File > New > Target > Unit Testing
/// Bundle ("SupWidgetTests", host app: none), add this file plus
/// SupWidget/WidgetData.swift to it, then Cmd+U. See SupWidget/README.md.
final class WidgetDataTests: XCTestCase {

    private let blob = """
        {
          "v": 1,
          "tasks": [
            {"id": "t1", "title": "Task one", "isDone": false, "projectId": "p1"},
            {"id": "t2", "title": "Task two", "isDone": true},
            {"id": "t3", "title": "Task three", "isDone": false, "projectId": null}
          ],
          "projectColors": {"p1": "#ff0000"}
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
}
