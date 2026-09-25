import Social
import UniformTypeIdentifiers

/// Uses the system compose sheet; content stays on-device until the app imports it.
/// https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html
final class ShareViewController: SLComposeServiceViewController {
    private var loaded = false
    private var saving = false
    private var sharedTitle = ""
    private var status = ""

    // Bundle the canonical English strings from en.json; no separate native copy
    // to drift from the app's translation source.
    private let strings: [String: String] = {
        guard let url = Bundle.main.url(forResource: "en", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let features = root["F"] as? [String: Any],
              let strings = features["IOS_SHARE"] as? [String: String] else {
            return [:]
        }
        return strings
    }()

    override func viewDidLoad() {
        super.viewDidLoad()
        status = strings["NEXT_OPEN"] ?? ""
        textView.isEditable = false
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        sharedTitle = items.compactMap { $0.attributedTitle?.string }.first ?? ""
        let providers = items.flatMap { $0.attachments ?? [] }
        Task { @MainActor in
            do {
                var parts = items.compactMap { $0.attributedContentText?.string }
                for provider in providers {
                    let type: String
                    if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                        type = UTType.url.identifier
                    } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                        type = UTType.plainText.identifier
                    } else {
                        continue
                    }
                    let item = try await provider.loadItem(forTypeIdentifier: type, options: nil)
                    let text = (item as? URL)?.absoluteString ?? (item as? String) ?? ""
                    if !text.isEmpty && !parts.contains(text) { parts.append(text) }
                }
                textView.text = parts.joined(separator: "\n\n")
                loaded = true
                textView.isEditable = true
            } catch {
                status = strings["INVALID"] ?? ""
            }
            validateContent()
            reloadConfigurationItems()
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        navigationController?.navigationBar.topItem?.rightBarButtonItem?.title = strings["SAVE"]
    }

    override func isContentValid() -> Bool {
        let text = contentText ?? ""
        return loaded && !saving && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && text.utf16.count <= 100_000
    }

    override func configurationItems() -> [Any]! {
        let destination = SLComposeSheetConfigurationItem()!
        destination.title = strings["DESTINATION"]
        destination.value = loaded && !isContentValid() && !saving ? strings["INVALID"] : status
        destination.tapHandler = nil
        return [destination]
    }

    override func didSelectPost() {
        guard isContentValid() else { return }
        saving = true
        validateContent()
        do {
            try ShareInbox.save(title: sharedTitle, text: contentText)
            extensionContext?.completeRequest(returningItems: nil)
        } catch {
            saving = false
            status = strings["SAVE_ERROR"] ?? ""
            reloadConfigurationItems()
            validateContent()
        }
    }
}
