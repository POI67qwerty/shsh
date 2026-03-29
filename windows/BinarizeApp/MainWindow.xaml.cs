using System;
using System.IO;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace BinarizeApp;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        try
        {
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BinarizeApp",
                "WebView2");

            var environment = await CoreWebView2Environment.CreateAsync(null, userData);
            await WebView.EnsureCoreWebView2Async(environment);

            var wwwPath = Path.Combine(AppContext.BaseDirectory, "www");
            if (!Directory.Exists(wwwPath))
            {
                MessageBox.Show("wwwフォルダが見つかりません。アプリ本体と同じ場所にwwwフォルダを配置してください。", "BinarizeApp");
                Close();
                return;
            }

            WebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "app.local",
                wwwPath,
                CoreWebView2HostResourceAccessKind.Allow);

            WebView.CoreWebView2.Navigate("https://app.local/index.html");
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "起動に失敗しました。\n\n" +
                "主な原因:\n" +
                "- WebView2 ランタイム未インストール\n" +
                "- 配布物から www フォルダが欠けている\n" +
                "- セキュリティソフトが関連ファイルを隔離している\n\n" +
                $"詳細:\n{ex.Message}",
                "BinarizeApp",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Close();
        }
    }
}
