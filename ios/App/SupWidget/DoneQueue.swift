import Darwin
import Foundation

enum DoneQueueStoreError: Error {
    case lockOpenFailed
    case lockFailed
    case sharedContainerUnavailable
}

struct DoneQueueEntry: Codable, Equatable {
    let target: Bool
    let revision: String
}

struct DoneQueueLease: Equatable {
    let targetsJson: String
    let token: String
}

/// File-backed last-wins done-target queue. Every read/modify/write and
/// acknowledgement is protected by a POSIX advisory lock in the App Group,
/// which coordinates the app and widget extension processes. Queue writes use
/// atomic file replacement so a process termination cannot leave partial JSON.
final class DoneQueueStore {
    private static let processLock = NSLock()
    private let queueURL: URL
    private let lockURL: URL
    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()

    init(containerURL: URL) {
        queueURL = containerURL.appendingPathComponent(WidgetShared.doneQueueFileName)
        lockURL = containerURL.appendingPathComponent(WidgetShared.doneQueueLockFileName)
    }

    func setTarget(taskId: String, isDone: Bool) throws {
        try withExclusiveLock {
            var targets = try readTargets()
            targets[taskId] = DoneQueueEntry(
                target: isDone,
                revision: UUID().uuidString
            )
            try writeTargets(targets)
        }
    }

    /// Returns a stable lease snapshot without deleting it.
    func read() throws -> DoneQueueLease? {
        try withExclusiveLock {
            let entries = try readTargets()
            guard !entries.isEmpty else { return nil }
            let targetData = try encoder.encode(entries.mapValues(\.target))
            let tokenData = try encoder.encode(entries)
            guard let targetsJson = String(data: targetData, encoding: .utf8),
                  let token = String(data: tokenData, encoding: .utf8)
            else {
                return nil
            }
            return DoneQueueLease(targetsJson: targetsJson, token: token)
        }
    }

    func peek() throws -> [String: Bool] {
        try withExclusiveLock { try readTargets().mapValues(\.target) }
    }

    /// Removes only entries whose unique revision still matches the lease.
    /// This preserves later taps even when they return to the same target value
    /// (the false→true ABA case), as well as newly added tasks.
    func acknowledge(_ token: String) throws {
        let leasedEntries = try JSONDecoder().decode(
            [String: DoneQueueEntry].self,
            from: Data(token.utf8)
        )
        try withExclusiveLock {
            var currentEntries = try readTargets()
            for (taskId, leasedEntry) in leasedEntries
            where currentEntries[taskId]?.revision == leasedEntry.revision {
                currentEntries.removeValue(forKey: taskId)
            }
            try writeTargets(currentEntries)
        }
    }

    private func withExclusiveLock<T>(_ body: () throws -> T) throws -> T {
        Self.processLock.lock()
        defer { Self.processLock.unlock() }

        let descriptor = Darwin.open(
            lockURL.path,
            O_CREAT | O_RDWR,
            S_IRUSR | S_IWUSR
        )
        guard descriptor >= 0 else {
            throw DoneQueueStoreError.lockOpenFailed
        }
        defer { Darwin.close(descriptor) }

        guard Darwin.flock(descriptor, LOCK_EX) == 0 else {
            throw DoneQueueStoreError.lockFailed
        }
        defer { Darwin.flock(descriptor, LOCK_UN) }

        return try body()
    }

    private func readTargets() throws -> [String: DoneQueueEntry] {
        guard FileManager.default.fileExists(atPath: queueURL.path) else {
            return [:]
        }
        return try JSONDecoder().decode(
            [String: DoneQueueEntry].self,
            from: Data(contentsOf: queueURL)
        )
    }

    private func writeTargets(_ targets: [String: DoneQueueEntry]) throws {
        if targets.isEmpty {
            if FileManager.default.fileExists(atPath: queueURL.path) {
                try FileManager.default.removeItem(at: queueURL)
            }
            return
        }
        try encoder.encode(targets).write(to: queueURL, options: .atomic)
    }
}

/// Shared app/extension facade around the App Group queue store.
enum DoneQueue {
    private static var store: DoneQueueStore? {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: WidgetShared.appGroupId
        ).map(DoneQueueStore.init(containerURL:))
    }

    static func setTarget(taskId: String, isDone: Bool) throws {
        guard let store else {
            throw DoneQueueStoreError.sharedContainerUnavailable
        }
        try store.setTarget(taskId: taskId, isDone: isDone)
    }

    static func peek() -> [String: Bool] {
        guard let store else { return [:] }
        return (try? store.peek()) ?? [:]
    }

    static func read() throws -> DoneQueueLease? {
        guard let store else {
            throw DoneQueueStoreError.sharedContainerUnavailable
        }
        return try store.read()
    }

    static func acknowledge(_ token: String) throws {
        guard let store else {
            throw DoneQueueStoreError.sharedContainerUnavailable
        }
        try store.acknowledge(token)
    }
}
