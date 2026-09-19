import Foundation

struct SharedCapture: Codable {
    let id: String
    let title: String
    let text: String
}

/// One immutable file per capture: extension writes and app acknowledgements
/// never overwrite each other, including when either process is suspended.
/// https://developer.apple.com/library/archive/technotes/tn2408/_index.html
enum ShareInbox {
    static let group = "group.com.super-productivity.app"

    static func directory() throws -> URL {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: group
        ) else {
            throw CocoaError(.fileNoSuchFile)
        }
        let directory = container.appendingPathComponent("ShareInbox", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    static func save(title: String, text: String) throws {
        let capture = SharedCapture(id: UUID().uuidString, title: title, text: text)
        let file = try directory().appendingPathComponent(capture.id).appendingPathExtension("json")
        try JSONEncoder().encode(capture).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func pending() throws -> [SharedCapture] {
        try FileManager.default.contentsOfDirectory(at: directory(), includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
            .map { try JSONDecoder().decode(SharedCapture.self, from: Data(contentsOf: $0)) }
    }

    static func acknowledge(id: String) throws {
        // IDs cross the JS bridge and become filenames; restrict to our UUIDs.
        guard let uuid = UUID(uuidString: id) else { throw CocoaError(.fileReadInvalidFileName) }
        let file = try directory().appendingPathComponent(uuid.uuidString).appendingPathExtension("json")
        if FileManager.default.fileExists(atPath: file.path) {
            try FileManager.default.removeItem(at: file)
        }
    }
}
