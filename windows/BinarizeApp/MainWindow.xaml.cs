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
        var userData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BinarizeApp",
            "WebView2");

        var environment = await CoreWebView2Environment.CreateAsync(null, userData);
        await WebView.EnsureCoreWebView2Async(environment);

        var wwwPath = Path.Combine(AppContext.BaseDirectory, "www");
        if (!Directory.Exists(wwwPath))
        {
            MessageBox.Show("wwwフォルダが見つかりません。アプリのフォルダにwwwを配置してください。", "BinarizeApp");
            return;
        }

        WebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "app.local",
            wwwPath,
            CoreWebView2HostResourceAccessKind.Allow);

        WebView.CoreWebView2.Navigate("https://app.local/index.html");
    }
}
