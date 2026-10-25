using System;
using System.Drawing;
using System.Windows.Forms;

internal static class QuotaPillTests {
    [STAThread] static void Main() {
        foreach (int percent in new[] { 0, 20, 50, 100 }) {
            using (var pill = new QuotaPill { Size = new Size(100, 34), Text = "", Progress = percent })
            using (var bitmap = new Bitmap(100, 34)) {
                if (pill.FillWidth != percent) throw new Exception("Fill width must equal percentage at 100px width");
                pill.DrawToBitmap(bitmap, pill.ClientRectangle);
                int track = Color.FromArgb(39,44,46).ToArgb();
                foreach (int x in new[] { 10, 30, 70, 90 }) {
                    bool colored = bitmap.GetPixel(x,17).ToArgb() != track;
                    if (colored != (x < percent)) throw new Exception("Rendered fill does not match " + percent + "% at x=" + x);
                }
            }
        }
        using (var unknown = new QuotaPill { Width = 100, Progress = null, Text = "—" })
            if (unknown.FillWidth != 0 || unknown.Text != "—") throw new Exception("Unknown must remain unknown");
        Console.WriteLine("PASS: 0/20/50/100 percent pixel checks and unknown state");
    }
}
