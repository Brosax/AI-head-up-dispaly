using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;
using Microsoft.Win32;

// Native controls keep keyboard navigation and readable accessibility labels.
internal sealed class TrayPopup : Form {
    Color Paper = Color.FromArgb(244, 245, 237);
    Color Ink = Color.FromArgb(39, 59, 48);
    Color Muted = Color.FromArgb(120, 134, 117);
    bool dark;
    readonly Button themeToggle;
    public Action<string> ThemeChanged;
    public string ThemeMode = "system";
    static readonly int[] Light = { 0xf4f5ed, 0x273b30, 0x788675, 0x30533e, 0xf7f8f1, 0x3e654b, 0xe6eadd, 0x9d7e4f, 0xdee4d7, 0xbb9462, 0x74977b, 0xa45e43, 0xcdd7c4, 0xd9e0cf };
    static readonly int[] Dark = { 0x0d0f10, 0xe4ece5, 0xa4b2a5, 0xb0d4b2, 0x16241a, 0xc3e3c3, 0x202627, 0xd1ae73, 0x2b3133, 0xcfa66b, 0x83b792, 0xe3a785, 0x383e40, 0x303638 };
    public Action RefreshRequested;
    readonly Button refresh;
    string refreshMessage;
    readonly Panel content;
    readonly Label status;
    CheckBox startup;
    Form settings;
    bool startupEnabled;
    readonly Action open, quit;
    readonly Action<bool> changeStartup;
    readonly ToolTip tips = new ToolTip();
    bool settingStartup;

    public TrayPopup(Action openToolbar, Action exit, Action<bool> setStartup) {
        open = openToolbar; quit = exit; changeStartup = setStartup;
        Text = "AI head-up dispaly · 额度速览"; AccessibleName = Text;
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
        StartPosition = FormStartPosition.Manual; BackColor = Paper; ForeColor = Ink;
        Font = new Font("Microsoft YaHei UI", 9F); AutoScaleMode = AutoScaleMode.None;
        ClientSize = new Size(392, 638); DoubleBuffered = true;
        content = new Panel { Location = new Point(18, 14), Size = new Size(356, 528), AutoScroll = true, BackColor = Paper };
        Controls.Add(content);
        status = Label("读取本机保存的额度…", 24, 548, 344, 20, new Font(Font.FontFamily, 8F), Muted);
        Controls.Add(status);
        themeToggle = IconButton("☀", 44, false);
        themeToggle.Click += delegate { string mode = dark ? "light" : "dark"; ApplyTheme(mode); if (ThemeChanged != null) ThemeChanged(mode); };
        Controls.Add(themeToggle);
        refresh = IconButton("↻", 130, true);
        refresh.AccessibleName = "后台刷新全部额度";
        tips.SetToolTip(refresh, "后台刷新全部额度");
        refresh.Click += delegate { if (RefreshRequested != null) RefreshRequested(); }; Controls.Add(refresh);
        var launch = IconButton("↗", 216, false);
        launch.AccessibleName = "打开工具栏"; tips.SetToolTip(launch, "打开工具栏");
        launch.Click += delegate { Hide(); open(); }; Controls.Add(launch);
        var leave = IconButton("⏻", 302, false);
        leave.AccessibleName = "退出 AI head-up dispaly"; tips.SetToolTip(leave, "退出 AI head-up dispaly");
        leave.Click += delegate { Hide(); quit(); }; Controls.Add(leave);
        Deactivate += delegate { Hide(); };
        ApplyTheme("system");
    }
    static Color Rgb(int rgb) { return Color.FromArgb(255, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255); }
    static Color Translate(Color color, bool toDark) {
        int[] from = toDark ? Light : Dark, to = toDark ? Dark : Light;
        for (int i = 0; i < from.Length; i++) if (color.ToArgb() == Rgb(from[i]).ToArgb()) return Rgb(to[i]);
        return color;
    }
    Color Tone(Color light) { return dark ? Translate(light, true) : light; }
    void Retint(Control control, bool toDark) {
        control.BackColor = Translate(control.BackColor, toDark); control.ForeColor = Translate(control.ForeColor, toDark);
        var button = control as Button;
        if (button != null) button.FlatAppearance.MouseOverBackColor = Translate(button.FlatAppearance.MouseOverBackColor, toDark);
        foreach (Control child in control.Controls) Retint(child, toDark);
    }
    public void ApplyTheme(string mode) {
        if (mode != "light" && mode != "dark" && mode != "system") mode = "system";
        bool next = mode == "dark";
        if (mode == "system") {
            using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                next = key != null && Convert.ToInt32(key.GetValue("AppsUseLightTheme", 1)) == 0;
        }
        ThemeMode = mode;
        if (dark != next) {
            Retint(this, next); if (settings != null && !settings.IsDisposed) Retint(settings, next); dark = next;
            Paper = Rgb(next ? Dark[0] : Light[0]); Ink = Rgb(next ? Dark[1] : Light[1]); Muted = Rgb(next ? Dark[2] : Light[2]);
        }
        themeToggle.Text = dark ? "☀" : "☾";
        string action = dark ? "切换到亮色" : "切换到暗色";
        themeToggle.AccessibleName = action;
        themeToggle.AccessibleDescription = "当前为" + (dark ? "暗色" : "亮色") + (mode == "system" ? "，跟随系统" : "");
        tips.SetToolTip(themeToggle, action);
        Invalidate(true);
    }
    static Label Label(string text, int x, int y, int w, int h, Font font, Color color) {
        return new Label { Text = text, Location = new Point(x, y), Size = new Size(w, h), Font = font, ForeColor = color,
            BackColor = Color.Transparent, AutoEllipsis = true, UseMnemonic = false, TextAlign = ContentAlignment.MiddleLeft };
    }
    Button Button(string text, int x, int y, int w, int h, bool primary) {
        var button = new Button { Text = text, Location = new Point(x, y), Size = new Size(w, h), FlatStyle = FlatStyle.Flat,
            BackColor = primary ? Color.FromArgb(48, 83, 62) : Paper, ForeColor = primary ? Color.FromArgb(247, 248, 241) : Muted,
            Cursor = Cursors.Hand, TabStop = true };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(62, 101, 75) : Color.FromArgb(230, 234, 221);
        if (primary) using (var path = Rounded(w - 1, h - 1, 14)) button.Region = new Region(path);
        return button;
    }
    Button IconButton(string icon, int x, bool primary) {
        Button button;
        if (primary || icon == "⏻") {
            button = primary ? (Button)new RefreshIconButton() : new PowerIconButton();
            button.Location=new Point(x,580);button.Size=new Size(46,42);button.FlatStyle=FlatStyle.Flat;button.Cursor=Cursors.Hand;button.TabStop=true;
        } else button=Button(icon,x,580,46,42,false);
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(230,234,221);
        button.Font = new Font("Segoe UI Symbol", 23F);
        button.BackColor = primary ? Rgb(Light[6]) : Paper; button.ForeColor = primary ? Color.FromArgb(62,101,75) : Muted;
        using (var path = Rounded(45, 41, 40)) button.Region = new Region(path);
        return button;
    }
    static GraphicsPath Rounded(int w, int h, int d) {
        var path = new GraphicsPath();
        path.AddArc(0, 0, d, d, 180, 90); path.AddArc(w-d, 0, d, d, 270, 90);
        path.AddArc(w-d, h-d, d, d, 0, 90); path.AddArc(0, h-d, d, d, 90, 90); path.CloseFigure();
        return path;
    }
    protected override void OnResize(EventArgs e) {
        base.OnResize(e);
        if (ClientSize.Width < 24 || ClientSize.Height < 24) return;
        var old = Region;
        using (var path = Rounded(ClientSize.Width, ClientSize.Height, 24)) Region = new Region(path);
        if (old != null) old.Dispose();
    }
    public void SetStartup(bool enabled) { startupEnabled = enabled; settingStartup = true; if (startup != null && !startup.IsDisposed) startup.Checked = enabled; settingStartup = false; }
    public void ShowSettings() {
        Hide();
        if (settings != null && !settings.IsDisposed) { settings.Show(); settings.Activate(); return; }
        settings = new Form { Text = "AI head-up dispaly · 设置", ClientSize = new Size(392, 228), FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false, MinimizeBox = false, StartPosition = FormStartPosition.CenterScreen, BackColor = Paper, ForeColor = Ink, Font = Font };
        settings.Controls.Add(Label("启动与退出", 24, 18, 344, 32, new Font(Font.FontFamily, 16F), Ink));
        startup = new CheckBox { Text = "登录 Windows 时启动 AI head-up dispaly", Location = new Point(26, 70), AutoSize = true, Checked = startupEnabled, ForeColor = Ink, BackColor = Paper };
        startup.CheckedChanged += delegate {
            if (settingStartup) return;
            changeStartup(startup.Checked);
        };
        settings.Controls.Add(startup);
        settings.Controls.Add(Label("启动后仅驻留托盘，不弹出工具栏。", 26, 96, 340, 26, new Font(Font.FontFamily, 8.5F), Muted));
        var leave = Button("退出 AI head-up dispaly", 24, 161, 160, 38, false);
        if (dark) Retint(leave, true);
        leave.ForeColor = Ink; leave.AccessibleName = "退出 AI head-up dispaly";
        leave.Click += delegate { settings.Close(); quit(); }; settings.Controls.Add(leave);
        var done = Button("完成", 264, 161, 104, 38, true);
        if (dark) Retint(done, true);
        done.Click += delegate { settings.Close(); }; settings.Controls.Add(done);
        settings.CancelButton = done; settings.AcceptButton = done;
        settings.Show(); settings.Activate();
    }
    public void SetRefreshState(bool busy, string message) {
        refresh.Enabled = !busy;
        refresh.AccessibleName = busy ? "正在后台刷新额度" : "后台刷新全部额度";
        tips.SetToolTip(refresh, refresh.AccessibleName);
        refreshMessage = message;
        status.Text = String.IsNullOrEmpty(message) ? "已保存的读数 · 点击刷新获取最新额度" : message;
        tips.SetToolTip(status, status.Text);
    }
    public void Present(Point anchor) {
        var area = Screen.FromPoint(anchor).WorkingArea;
        Location = new Point(Math.Max(area.Left + 8, Math.Min(anchor.X - Width + 12, area.Right - Width - 8)),
            Math.Max(area.Top + 8, Math.Min(anchor.Y - Height - 10, area.Bottom - Height - 8)));
        Show(); Activate();
    }
    public void SetCards(List<QuotaSummary.Card> cards, bool failed) {
        content.SuspendLayout();
        while (content.Controls.Count > 0) { var old = content.Controls[0]; content.Controls.Remove(old); old.Dispose(); }
        int y = 0;
        if (cards != null) foreach (var card in cards) {
            bool money=card.Id=="deepseek"||card.Id=="claude-api";
            bool pairedMoney=card.Id=="deepseek";
            int count=Math.Max(1,card.Metrics.Count);
            int rowHeight=pairedMoney?66:count*48+14;
            if(!String.IsNullOrEmpty(card.Account))rowHeight+=18;
            var row=new Panel {Location=new Point(0,y),Size=new Size(336,rowHeight),BackColor=Paper};
            Color accent=card.Id=="openai"?Color.FromArgb(126,226,191):card.Id=="anthropic"||card.Id=="claude-api"?Color.FromArgb(255,175,126):card.Id=="xai"?Color.FromArgb(155,187,243):card.Id=="google"?Color.FromArgb(174,149,246):Color.FromArgb(113,199,232);
            var dot=new Panel {Location=new Point(3,29),Size=new Size(9,9),BackColor=accent};
            using(var circle=Rounded(9,9,9))dot.Region=new Region(circle);row.Controls.Add(dot);
            row.Controls.Add(Label(card.Name,20,18,93,30,new Font("Segoe UI",10F,FontStyle.Bold),Ink));
            if(!String.IsNullOrEmpty(card.Account)) {var account=Label(card.Account,20,rowHeight-22,306,16,new Font(Font.FontFamily,7F),Muted);tips.SetToolTip(account,card.Account);row.Controls.Add(account);}
            if(card.Metrics.Count==0)row.Controls.Add(Label("尚未读取",118,24,212,26,Font,Muted));
            for(int i=0;i<card.Metrics.Count;i++) {
                var metric=card.Metrics[i];int x=118+(pairedMoney?i%2*110:0),top=pairedMoney?0:i*48,width=pairedMoney?104:216;
                string stale=metric.Status=="fresh"?"":" · 上次";
                string caption=metric.Label+stale;
                var label=Label(caption,x,top+6,metric.Reset==null?width:58,17,new Font(Font.FontFamily,7F),Muted);
                tips.SetToolTip(label,metric.Detail??caption);row.Controls.Add(label);
                if(!String.IsNullOrEmpty(metric.Reset)) {var reset=Label(metric.Reset,x+55,top+6,width-55,17,new Font(Font.FontFamily,7F),Muted);reset.TextAlign=ContentAlignment.MiddleRight;tips.SetToolTip(reset,metric.Detail??metric.Reset);row.Controls.Add(reset);}
                Control amount=money
                    ?(Control)Label(metric.Value,x,top+25,width,31,new Font("Segoe UI",pairedMoney?17F:18F,FontStyle.Regular),Ink)
                    :new QuotaPill {Text=metric.Value,Provider=card.Id,Progress=metric.Percent,Location=new Point(x,top+26),Size=new Size(width,27),Font=new Font("Segoe UI",13F,FontStyle.Bold)};
                amount.AccessibleName=card.Name+" "+caption+" "+metric.Value+" "+metric.Reset;tips.SetToolTip(amount,metric.Detail??metric.Value);row.Controls.Add(amount);
            }
            row.Controls.Add(new Panel {Location=new Point(3,rowHeight-1),Size=new Size(329,1),BackColor=Tone(Color.FromArgb(217,224,207))});
            content.Controls.Add(row);y+=row.Height;
        }
        content.ResumeLayout();
        if (dark) Retint(content, true);
        status.Text = failed ? "本机连接失败 · 保留上次读数" : refreshMessage ?? "已保存的读数 · 点击刷新获取最新额度";
        status.ForeColor = failed ? Tone(Color.FromArgb(164,94,67)) : Muted;
    }
    protected override bool ProcessCmdKey(ref Message msg, Keys keyData) {
        if (keyData == Keys.Escape) { Hide(); return true; }
        return base.ProcessCmdKey(ref msg, keyData);
    }
    protected override CreateParams CreateParams { get { var cp = base.CreateParams; cp.ClassStyle |= 0x20000; return cp; } }
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e); e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var path = new GraphicsPath()) {
            int d = 24, w = ClientSize.Width - 1, h = ClientSize.Height - 1;
            path.AddArc(0, 0, d, d, 180, 90); path.AddArc(w-d, 0, d, d, 270, 90);
            path.AddArc(w-d, h-d, d, d, 0, 90); path.AddArc(0, h-d, d, d, 90, 90); path.CloseFigure();
            using (var pen = new Pen(Tone(Color.FromArgb(205, 215, 196)))) e.Graphics.DrawPath(pen, path);
        }
        using (var pen = new Pen(Tone(Color.FromArgb(217, 224, 207)))) { e.Graphics.DrawLine(pen, 24, 572, 368, 572); }
    }
    protected override void Dispose(bool disposing) { if (disposing) { tips.Dispose(); if (settings != null) settings.Dispose(); } base.Dispose(disposing); }
}

// Draw around the button's actual centre; Unicode glyph side bearings vary by font/DPI.
internal sealed class RefreshIconButton : Button {
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);
        var g=e.Graphics; g.SmoothingMode=SmoothingMode.AntiAlias;
        float cx=ClientSize.Width/2f, cy=ClientSize.Height/2f;
        using(var pen=new Pen(Enabled?ForeColor:SystemColors.GrayText,1.8f)) {
            pen.StartCap=LineCap.Round;pen.EndCap=LineCap.Round;
            g.DrawArc(pen,cx-8,cy-8,16,16,-40,300);
            float tipX=cx+6.13f,tipY=cy-5.14f;
            g.DrawLines(pen,new[]{new PointF(tipX-5,tipY),new PointF(tipX,tipY),new PointF(tipX,tipY-5)});
        }
    }
}

internal sealed class PowerIconButton : Button {
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);
        var g=e.Graphics;g.SmoothingMode=SmoothingMode.AntiAlias;
        float cx=ClientSize.Width/2f,cy=ClientSize.Height/2f;
        using(var pen=new Pen(Enabled?ForeColor:SystemColors.GrayText,1.8f)) {
            pen.StartCap=LineCap.Round;pen.EndCap=LineCap.Round;
            g.DrawArc(pen,cx-8,cy-8,16,16,-50,280);
            g.DrawLine(pen,cx,cy-10,cx,cy-2);
        }
    }
}

internal sealed class QuotaPill : Control {
    public string Provider;
    public decimal? Progress;
    internal int FillWidth { get { return Progress.HasValue ? (int)Math.Round(Width * Math.Max(0, Math.Min(100, Progress.Value)) / 100, MidpointRounding.AwayFromZero) : 0; } }
    public QuotaPill() { SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true); BackColor = Color.Transparent; AccessibleRole = AccessibleRole.StaticText; }
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e); var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
        Color start = Color.FromArgb(178,245,207), end = Color.FromArgb(67,204,181);
        if (Provider == "anthropic") { start=Color.FromArgb(255,217,144);end=Color.FromArgb(255,141,103); }
        if (Provider == "xai") { start=Color.FromArgb(178,232,247);end=Color.FromArgb(121,171,240); }
        if (Provider == "google") { start=Color.FromArgb(105,205,239);end=Color.FromArgb(175,122,242); }
        if (Provider == "deepseek") { start=Color.FromArgb(23,65,112);end=Color.FromArgb(42,103,141); }
        if (Text == "—") { start=Color.FromArgb(58,64,66);end=Color.FromArgb(79,86,88); }
        using (var path = new GraphicsPath()) {
            int d=Height-2,w=Width-1,h=Height-1;
            path.AddArc(0,0,d,d,90,180);path.AddArc(w-d,0,d,d,270,180);path.CloseFigure();
            using(var track=new SolidBrush(Color.FromArgb(39,44,46)))g.FillPath(track,path);
            var saved=g.Save();g.SetClip(path);
            if(FillWidth>0)using(var gradient=new LinearGradientBrush(ClientRectangle,start,end,20F))g.FillRectangle(gradient,0,0,FillWidth,Height);
            g.Restore(saved);
            using(var pen=new Pen(Color.FromArgb(55,255,255,255)))g.DrawPath(pen,path);
        }
        var flags=TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter|TextFormatFlags.EndEllipsis|TextFormatFlags.NoPrefix;
        TextRenderer.DrawText(g,Text,Font,ClientRectangle,Color.FromArgb(249,251,250),flags);
        if(FillWidth>0) {var saved=g.Save();g.SetClip(new Rectangle(0,0,FillWidth,Height));TextRenderer.DrawText(g,Text,Font,ClientRectangle,Color.FromArgb(11,28,29),flags|TextFormatFlags.PreserveGraphicsClipping);g.Restore(saved);}

    }
}
