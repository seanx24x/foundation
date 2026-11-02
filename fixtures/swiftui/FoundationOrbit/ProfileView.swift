import SwiftUI

struct ProfileView: View {
    @StateObject private var store = ProfileStore()
    @State private var simulateFailure = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Profile") {
                    TextField("Display name", text: $store.displayName)
                        .textContentType(.name)
                        .accessibilityIdentifier("profile.displayName")
                    Text("This name appears on your profile.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section {
                    Button {
                        store.save(using: DemoProfileService(shouldFail: simulateFailure))
                    } label: {
                        HStack(spacing: 8) {
                            if store.state == .saving { ProgressView() }
                            Text(store.state == .saving ? "Saving…" : "Save changes")
                        }
                    }
                    .disabled(store.state == .saving)
                    .accessibilityIdentifier("profile.save")
                    if store.state == .saving {
                        Button("Cancel", role: .cancel) { store.cancel() }
                            .accessibilityIdentifier("profile.cancel")
                    }
                    if store.state == .saved {
                        Label("Changes saved", systemImage: "checkmark.circle")
                            .foregroundStyle(.green)
                            .accessibilityIdentifier("profile.saved")
                    }
                    if case .failed(let message) = store.state {
                        Label(message, systemImage: "exclamationmark.circle")
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("profile.error")
                    }
                }
                Section("Fixture scenario") {
                    Toggle("Simulate unavailable service", isOn: $simulateFailure)
                        .accessibilityIdentifier("scenario.failure")
                    Text("Saves are simulated locally. This fixture does not send profile data or produce API evidence.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Profile")
        }
    }
}

#Preview { ProfileView() }
