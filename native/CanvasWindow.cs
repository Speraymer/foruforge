using System;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

internal sealed class CanvasWindow : Form
{
    private Point dragOffset;
    private bool dragging;

    public CanvasWindow(string url, string profile)
    {
        Text = "项目约束";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        var area = Screen.PrimaryScreen.WorkingArea;
        Size = new Size(Math.Min(2280, area.Width - 80), Math.Min(1440, area.Height - 80));
        MinimumSize = new Size(980, 650);
        BackColor = Color.FromArgb(7, 19, 31);
        var view = new WebView2 { Dock = DockStyle.Fill };
        view.CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = profile };
        var origin = new Uri(url).GetLeftPart(UriPartial.Authority);
        view.NavigationStarting += (sender, e) => {
            Uri target;
            if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out target) || target.GetLeftPart(UriPartial.Authority) != origin) e.Cancel = true;
        };
        view.CoreWebView2InitializationCompleted += (sender, e) => {
            if (!e.IsSuccess) { MessageBox.Show(e.InitializationException.Message, "项目约束启动失败"); Close(); return; }
            view.CoreWebView2.NewWindowRequested += (window, request) => request.Handled = true;
            view.CoreWebView2.WebMessageReceived += (window, message) => {
                switch (message.TryGetWebMessageAsString()) {
                    case "drag-start": dragOffset = new Point(Cursor.Position.X - Left, Cursor.Position.Y - Top); dragging = true; break;
                    case "drag-move": if (dragging) Location = new Point(Cursor.Position.X - dragOffset.X, Cursor.Position.Y - dragOffset.Y); break;
                    case "drag-end": dragging = false; break;
                }
            };
        };
        view.NavigationCompleted += (sender, e) => {
            if (!e.IsSuccess) { MessageBox.Show("画布页面加载失败", "项目约束启动失败"); Close(); }
        };
        Controls.Add(view);
        view.Source = new Uri(url);
    }

    [STAThread]
    private static void Main(string[] args)
    {
        Uri url;
        if (args.Length != 2 || !Uri.TryCreate(args[0], UriKind.Absolute, out url) || url.Scheme != "http" || url.Host != "127.0.0.1") throw new ArgumentException("Local canvas URL required");
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new CanvasWindow(args[0], args[1]));
    }
}
