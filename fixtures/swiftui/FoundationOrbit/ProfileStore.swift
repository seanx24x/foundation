import Combine
import Foundation

protocol ProfileSaving: Sendable {
    func save(displayName: String) async throws
}

enum SaveState: Equatable {
    case idle
    case saving
    case saved
    case failed(String)
}

/// Owns one save attempt. A cancelled or superseded attempt cannot publish a result.
@MainActor
final class ProfileStore: ObservableObject {
    @Published var displayName = "Alex Morgan"
    @Published private(set) var state: SaveState = .idle
    @Published private(set) var lastSavedName: String?

    private var generation = UUID()
    private var task: Task<Void, Never>?

    @discardableResult
    func save(using service: any ProfileSaving) -> Task<Void, Never>? {
        guard state != .saving else { return nil }
        let submittedName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !submittedName.isEmpty else {
            state = .failed("Enter your name before saving.")
            return nil
        }
        let attempt = UUID()
        generation = attempt
        state = .saving
        let attemptTask = Task { [weak self] in
            do {
                try await service.save(displayName: submittedName)
                guard let self, self.generation == attempt else { return }
                self.lastSavedName = submittedName
                self.state = .saved
                self.task = nil
            } catch {
                guard let self, self.generation == attempt else { return }
                self.state = error is CancellationError ? .idle : .failed(error.localizedDescription)
                self.task = nil
            }
        }
        task = attemptTask
        return attemptTask
    }

    func cancel() {
        generation = UUID()
        task?.cancel()
        task = nil
        if state == .saving { state = .idle }
    }

    deinit { task?.cancel() }
}

/// Local fixture behavior only. No network request is made.
struct DemoProfileService: ProfileSaving {
    let shouldFail: Bool

    func save(displayName: String) async throws {
        try await Task.sleep(nanoseconds: 400_000_000)
        try Task.checkCancellation()
        if shouldFail { throw ProfileSaveError.unavailable }
    }
}

enum ProfileSaveError: LocalizedError {
    case unavailable
    var errorDescription: String? {
        "The sample service is unavailable. Your changes are still here. Try again."
    }
}
