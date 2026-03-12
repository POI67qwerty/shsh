import SwiftUI
import WebKit
#if os(macOS)
import UniformTypeIdentifiers
#elseif os(iOS)
import UniformTypeIdentifiers
import UIKit
#endif

struct WebView: View {
    var body: some View {
        WebViewRepresentable()
    }
}

#if os(iOS)
struct WebViewRepresentable: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let webView = makeWebView(context: context)
        // isOpaque=falseにすると読み込み前が真っ黒になるためtrueのまま
        // 背景色をHTMLのbody背景(#0f0f11)に合わせて黒帯を目立たなくする
        webView.isOpaque = true
        webView.backgroundColor = UIColor(red: 0.059, green: 0.059, blue: 0.067, alpha: 1.0)
        webView.scrollView.backgroundColor = UIColor(red: 0.059, green: 0.059, blue: 0.067, alpha: 1.0)
        loadLocalContent(webView)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // Split View / Slide Over でウィンドウサイズ変化時にviewportをリセット
        uiView.evaluateJavaScript("""
            (function(){
                var m = document.querySelector('meta[name=viewport]');
                if(m){ var c = m.content; m.content=''; m.content=c; }
            })();
        """, completionHandler: nil)
    }
}
#elseif os(macOS)
struct WebViewRepresentable: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let webView = makeWebView(context: context)
        loadLocalContent(webView)
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        // No-op
    }
}
#endif

private func makeWebView(context: WebViewRepresentable.Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.preferences.javaScriptCanOpenWindowsAutomatically = true
    config.userContentController.add(context.coordinator, name: "saveImage")
    config.userContentController.add(context.coordinator, name: "copyImage")  // クリップボードコピー用

    let webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = context.coordinator
    webView.uiDelegate = context.coordinator
    webView.allowsBackForwardNavigationGestures = true
    return webView
}

private func loadLocalContent(_ webView: WKWebView) {
    // Xcodegenのresources設定により、wwwがフラット配置される場合があるためフォールバックする。
    if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
        let accessURL = indexURL.deletingLastPathComponent()
        webView.loadFileURL(indexURL, allowingReadAccessTo: accessURL)
        return
    }
    if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html") {
        let accessURL = indexURL.deletingLastPathComponent()
        webView.loadFileURL(indexURL, allowingReadAccessTo: accessURL)
    }
}

extension WebViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }
}

final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
        }
        return nil
    }

#if os(macOS)
    func webView(_ webView: WKWebView,
                 runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.allowedContentTypes = [UTType.image]
        panel.begin { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }
#endif
}

extension Coordinator: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // ===== 保存ダイアログ =====
        if message.name == "saveImage" {
            guard let body = message.body as? [String: Any],
                  let filename = body["filename"] as? String,
                  let dataURL = body["dataURL"] as? String,
                  let data = decodeDataURL(dataURL) else { return }
#if os(macOS)
            saveOnMac(data: data, filename: filename)
#elseif os(iOS)
            saveOniOS(data: data, filename: filename)
#endif
        }

        // ===== クリップボードコピー =====
        if message.name == "copyImage" {
            guard let body = message.body as? [String: Any],
                  let dataURL = body["dataURL"] as? String,
                  let data = decodeDataURL(dataURL),
                  let image = platformImage(from: data) else { return }
#if os(macOS)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.writeObjects([image])
            // JS側にコピー完了を通知
            if let wv = body["_wv"] as? WKWebView {
                wv.evaluateJavaScript("window._onCopyDone && window._onCopyDone(true)")
            }
#elseif os(iOS)
            UIPasteboard.general.image = image
#endif
        }
    }

    private func decodeDataURL(_ dataURL: String) -> Data? {
        guard let base64Range = dataURL.range(of: "base64,") else { return nil }
        let b64 = String(dataURL[base64Range.upperBound...])
        return Data(base64Encoded: b64)
    }

#if os(macOS)
    private func platformImage(from data: Data) -> NSImage? { NSImage(data: data) }
#elseif os(iOS)
    private func platformImage(from data: Data) -> UIImage? { UIImage(data: data) }
#endif
}

#if os(macOS)
private func saveOnMac(data: Data, filename: String) {
    DispatchQueue.main.async {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = filename
        panel.allowedContentTypes = [UTType.png]
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            try? data.write(to: url)
        }
    }
}
#endif

#if os(iOS)
private func saveOniOS(data: Data, filename: String) {
    DispatchQueue.main.async {
        let tmpURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        do {
            try data.write(to: tmpURL)
        } catch {
            return
        }
        let picker = UIDocumentPickerViewController(forExporting: [tmpURL], asCopy: true)
        picker.modalPresentationStyle = .formSheet
        if let vc = topViewController() {
            vc.present(picker, animated: true)
        }
    }
}

private func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
    let window = scenes.first?.windows.first { $0.isKeyWindow }
    var root = window?.rootViewController
    while let presented = root?.presentedViewController {
        root = presented
    }
    return root
}
#endif
