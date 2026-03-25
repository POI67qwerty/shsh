# Windows

WPF + WebView2 でローカル `www` を表示します。Visual Studioまたは `dotnet` でビルドできます。

**手順**
1. `windows/BinarizeApp` を Visual Studio で開きます。
2. NuGet 復元後にビルドして実行します。
3. `www` の内容を更新したい場合は `windows/BinarizeApp/www` を置き換えます。
4. アプリアイコンを差し替える場合は `windows/BinarizeApp/Assets/app.ico` を置き換えます。

**補足**
- WebView2 のランタイムが必要です。未インストールの場合、Windowsが案内します。
- `.ico` は 16, 32, 48, 256px など複数サイズを含めると、エクスプローラーやタスクバーで綺麗に表示されます。
