# Apple（macOS/iPad/iPhone）

このフォルダには SwiftUI + WKWebView のシェル実装があります。Xcodeで新規プロジェクトを作成し、下記のファイルを差し替えて使います。

**手順**
1. Xcodeで「App」プロジェクトを作成します。`Product Name` は `BinarizeApp` を推奨します。
2. 作成された `ContentView.swift` と `YourAppNameApp.swift` を削除し、次のファイルに差し替えます。
   `BinarizeApp.swift`
   `ContentView.swift`
   `WebView.swift`
3. プロジェクトに `www` フォルダを追加します。
   追加方法は「Add Files to ...」で `../www` を選び、`Create folder references` を選択します。
4. iOS用に `Info.plist` に `NSPhotoLibraryUsageDescription` を追加します。
   例: `画像読み込みのために写真ライブラリを使用します。`
5. 実機ビルドして起動します。

**補足**
- `window.open()` を使う保存ページは、アプリ内では同じWebViewで開くように処理しています。
- `www` を差し替えるだけで内容更新できます。
