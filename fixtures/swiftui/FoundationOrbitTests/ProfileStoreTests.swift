import XCTest

actor ControlledProfileService: ProfileSaving {
    private var requests: [String] = []
    private var pending: [Int: CheckedContinuation<Void, Error>] = [:]

    func save(displayName: String) async throws {
        let index = requests.count
        requests.append(displayName)
        try await withCheckedThrowingContinuation { continuation in
            pending[index] = continuation
        }
    }

    func submittedNames() -> [String] { requests }
    func resolve(_ index: Int, error: Error? = nil) {
        guard let continuation = pending.removeValue(forKey: index) else { return }
        if let error { continuation.resume(throwing: error) }
        else { continuation.resume() }
    }
}

final class ProfileStoreTests: XCTestCase {
    @MainActor
    private func waitFor(_ condition: @escaping @MainActor () async -> Bool,
                         file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<500 {
            if await condition() { return }
            try? await Task.sleep(nanoseconds: 2_000_000)
        }
        XCTFail("Expected state was not reached", file: file, line: line)
    }

    @MainActor
    func testSaveShowsLoadingUntilServiceCompletes() async {
        let store = ProfileStore()
        let service = ControlledProfileService()
        store.save(using: service)
        XCTAssertEqual(store.state, .saving)
        await waitFor { await service.submittedNames().count == 1 }
        XCTAssertNil(store.lastSavedName)
        await service.resolve(0)
        await waitFor { store.state == .saved }
        XCTAssertEqual(store.lastSavedName, "Alex Morgan")
    }

    @MainActor
    func testFailurePreservesDraftAndRetrySucceeds() async {
        let store = ProfileStore()
        let service = ControlledProfileService()
        store.displayName = "Sam Rivera"
        store.save(using: service)
        await waitFor { await service.submittedNames().count == 1 }
        await service.resolve(0, error: ProfileSaveError.unavailable)
        await waitFor { if case .failed = store.state { return true }; return false }
        XCTAssertEqual(store.displayName, "Sam Rivera")
        XCTAssertNil(store.lastSavedName)
        store.save(using: service)
        await waitFor { await service.submittedNames().count == 2 }
        await service.resolve(1)
        await waitFor { store.state == .saved }
        XCTAssertEqual(store.lastSavedName, "Sam Rivera")
    }

    @MainActor
    func testRepeatedSaveDoesNotStartDuplicateRequest() async {
        let store = ProfileStore()
        let service = ControlledProfileService()
        store.save(using: service)
        store.save(using: service)
        await waitFor { await service.submittedNames().count == 1 }
        await service.resolve(0)
        await waitFor { store.state == .saved }
        let names = await service.submittedNames()
        XCTAssertEqual(names.count, 1)
    }

    @MainActor
    func testCancelledCompletionCannotPublishSuccess() async {
        let store = ProfileStore()
        let service = ControlledProfileService()
        let attempt = store.save(using: service)
        await waitFor { await service.submittedNames().count == 1 }
        store.cancel()
        XCTAssertEqual(store.state, .idle)
        await service.resolve(0)
        await attempt?.value
        XCTAssertEqual(store.state, .idle)
        XCTAssertNil(store.lastSavedName)
    }

    @MainActor
    func testOlderAttemptCannotOverwriteNewAttempt() async {
        let store = ProfileStore()
        let service = ControlledProfileService()
        let olderAttempt = store.save(using: service)
        await waitFor { await service.submittedNames().count == 1 }
        store.cancel()
        store.displayName = "New name"
        store.save(using: service)
        await waitFor { await service.submittedNames().count == 2 }
        await service.resolve(1)
        await waitFor { store.state == .saved }
        await service.resolve(0, error: ProfileSaveError.unavailable)
        await olderAttempt?.value
        XCTAssertEqual(store.state, .saved)
        XCTAssertEqual(store.lastSavedName, "New name")
    }

    @MainActor
    func testEmptyNameFailsWithoutCallingService() async {
        let store = ProfileStore()
        let service = ControlledProfileService()
        store.displayName = " \n "
        store.save(using: service)
        XCTAssertEqual(store.state, .failed("Enter your name before saving."))
        let names = await service.submittedNames()
        XCTAssertTrue(names.isEmpty)
    }

    @MainActor
    func testSavedNameUsesSubmittedSnapshot() async {
        let store = ProfileStore()
        let service = ControlledProfileService()
        store.displayName = " First name "
        store.save(using: service)
        await waitFor { await service.submittedNames().count == 1 }
        store.displayName = "Edited while saving"
        await service.resolve(0)
        await waitFor { store.state == .saved }
        let names = await service.submittedNames()
        XCTAssertEqual(names, ["First name"])
        XCTAssertEqual(store.lastSavedName, "First name")
        XCTAssertEqual(store.displayName, "Edited while saving")
    }
}
