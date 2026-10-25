using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;

internal static class TrayPopupPreview {
    [STAThread] static void Main(string[] args) {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var popup = new TrayPopup(delegate {}, delegate {}, delegate(bool enabled) {})) {
            popup.SetStartup(true);
            popup.ApplyTheme(args.Length > 2 ? args[2] : "light");
            popup.SetCards(QuotaSummary.Cards(File.ReadAllText(args[0])), false);
            popup.Opacity = 0;
            popup.Show();
            Application.DoEvents();
            using (var bitmap = new Bitmap(popup.Width, popup.Height)) {
                popup.DrawToBitmap(bitmap, popup.ClientRectangle);
                bitmap.Save(args[1], ImageFormat.Png);
            }
        }
    }
}
