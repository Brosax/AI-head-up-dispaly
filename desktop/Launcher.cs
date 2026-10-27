using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class HeadroomLauncher {
    static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    static string StartupCommand { get { return "\"" + Path.Combine(Root, "Headroom.exe") + "\" --background"; } }
    static string StartupShortcut { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "AI head-up dispaly.lnk"); } }
    static object ShortcutMember(object shortcut, string name, System.Reflection.BindingFlags flags, params object[] args) {
        return shortcut.GetType().InvokeMember(name, flags, null, shortcut, args);
    }
    static bool StartupShortcutMatches(bool create) {
        if (!create && !File.Exists(StartupShortcut)) return false;
        object shell = null, shortcut = null;
        try {
            shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
            shortcut = shell.GetType().InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { StartupShortcut });
            string target = Path.Combine(Root, "AI-head-up-dispaly.exe");
            if (create) {
                ShortcutMember(shortcut, "TargetPath", System.Reflection.BindingFlags.SetProperty, target);
                ShortcutMember(shortcut, "Arguments", System.Reflection.BindingFlags.SetProperty, "--background");
                ShortcutMember(shortcut, "WorkingDirectory", System.Reflection.BindingFlags.SetProperty, Root);
                ShortcutMember(shortcut, "Description", System.Reflection.BindingFlags.SetProperty, "AI head-up dispaly");
                ShortcutMember(shortcut, "Save", System.Reflection.BindingFlags.InvokeMethod);
            }
            return String.Equals(ShortcutMember(shortcut, "TargetPath", System.Reflection.BindingFlags.GetProperty) as string, target, StringComparison.OrdinalIgnoreCase)
                && String.Equals(ShortcutMember(shortcut, "Arguments", System.Reflection.BindingFlags.GetProperty) as string, "--background", StringComparison.Ordinal);
        } finally {
            if (shortcut != null) Marshal.FinalReleaseComObject(shortcut);
            if (shell != null) Marshal.FinalReleaseComObject(shell);
        }
    }
    static string InstanceName {
        get {
            using (var hash = SHA256.Create())
                return @"Local\Headroom-" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(
                    Root.ToLowerInvariant() + WindowsIdentity.GetCurrent().User.Value))).Replace("-", "").Substring(0, 24);
        }
    }
    static bool StartupEnabled() {
        if (StartupShortcutMatches(false)) return true;
        using (var key = Registry.CurrentUser.OpenSubKey(RunKey))
            return key != null && String.Equals(key.GetValue("Headroom") as string, StartupCommand, StringComparison.OrdinalIgnoreCase);
    }
    static void SetStartup(bool enabled) {
        if (enabled) {
            if (!StartupShortcutMatches(true)) throw new IOException("Could not verify the startup shortcut.");
        } else if (StartupShortcutMatches(false)) File.Delete(StartupShortcut);
        // Migrate only this installation's old entry, avoiding duplicate launches.
        using (var key = Registry.CurrentUser.CreateSubKey(RunKey)) {
            if (String.Equals(key.GetValue("Headroom") as string, StartupCommand, StringComparison.OrdinalIgnoreCase))
                key.DeleteValue("Headroom", false);
        }
        Log("STARTUP " + (enabled ? "enabled" : "disabled"));
    }
    static string Find(string file, string directory) {
        string candidate = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), directory, file);
        if (File.Exists(candidate)) return candidate;
        candidate = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), directory, file);
        if (File.Exists(candidate)) return candidate;
        foreach (string entry in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) {
            try { candidate = Path.Combine(entry.Trim('"'), file); if (File.Exists(candidate)) return candidate; } catch {}
        }
        throw new FileNotFoundException("Required application was not found: " + file);
    }
    static bool Ready() {
        try {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:4317/api/dashboard");
            request.Timeout = 1200; request.Proxy = null;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
                return reader.ReadToEnd().Contains("\"providers\"");
        } catch { return false; }
    }
    static void Log(string message) {
        try {
            Directory.CreateDirectory(Path.Combine(Root,"artifacts"));
            File.AppendAllText(Path.Combine(Root,"artifacts","launcher.log"), DateTimeOffset.Now.ToString("o")+" "+message+Environment.NewLine);
        } catch {}
    }

    sealed class TrayContext : ApplicationContext {
        readonly NotifyIcon tray;
        readonly Form dispatcher = new Form();
        readonly System.Windows.Forms.Timer signals = new System.Windows.Forms.Timer();
        readonly EventWaitHandle show, stop, peek, settingsEvent;
        readonly string node, edge;
        readonly TrayPopup popup;
        readonly object serviceLock = new object();
        Process ownedService;
        bool opening, readingSummary, savingTheme, startingRefresh;
        DateTime lastSummary = DateTime.MinValue;
        string themeMode = "system";
        string summarySignature;
        int themeRevision;
        volatile bool exiting;
        List<QuotaSummary.Card> summary;
        DateTime lastLaunch = DateTime.MinValue;

        public TrayContext(string nodePath, string edgePath, EventWaitHandle showEvent, EventWaitHandle stopEvent, EventWaitHandle peekEvent, EventWaitHandle openSettingsEvent, bool background, bool preview, bool settingsOnStart) {
            node = nodePath; edge = edgePath; show = showEvent; stop = stopEvent; peek = peekEvent; settingsEvent = openSettingsEvent;
            // Create an invisible UI dispatcher; it never appears in the taskbar.
            IntPtr handle = dispatcher.Handle;
            popup = new TrayPopup(OpenToolbar, ExitThread, delegate(bool enabled) {
                try { SetStartup(enabled); }
                catch (Exception error) { popup.SetStartup(StartupEnabled()); ShowError(error); }
            });
            popup.ThemeChanged = SaveTheme;
            popup.RefreshRequested = StartRefresh;
            // Prepare the native handle while hidden, before the first tray click.
            IntPtr popupHandle = popup.Handle;
            tray = new NotifyIcon {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath),
                Text = "AI head-up dispaly · 点击打开 AI 额度",
                Visible = true
            };
            tray.MouseClick += delegate(object sender, MouseEventArgs e) {
                if (e.Button == MouseButtons.Left) { popup.Hide(); OpenToolbar(); }
                if (e.Button == MouseButtons.Right) ShowPopup();
            };
            signals.Interval = 200;
            signals.Tick += delegate {
                if (stop.WaitOne(0)) { ExitThread(); return; }
                if (peek.WaitOne(0)) ShowPopup();
                if (settingsEvent.WaitOne(0)) OpenSettings();
                if (show.WaitOne(0)) OpenToolbar();
                if (popup.Visible && !savingTheme && (DateTime.UtcNow - lastSummary).TotalSeconds > 2) ReadSummary();
            };
            signals.Start();
            Log("TRAY ready; background=" + background);
            ReadSummary(); // Start the local bridge even when the toolbar stays closed.
            if (preview) ShowPopup();
            if (settingsOnStart) OpenSettings();
            if (!background) OpenToolbar();
        }

        void OpenSettings() {
            popup.ApplyTheme(themeMode); popup.SetStartup(StartupEnabled()); popup.ShowSettings(); ReadSummary();
            Log("SETTINGS shown");
        }

        void ShowPopup() {
            var clock = Stopwatch.StartNew();
            popup.Present(Cursor.Position);
            clock.Stop();
            // The cached controls/theme are already ready. Settings and disk I/O
            // do not belong on the right-click display path.
            ThreadPool.QueueUserWorkItem(delegate { Log("POPUP shown; presentMs=" + clock.ElapsedMilliseconds); });
            dispatcher.BeginInvoke((Action)delegate {
                if (!exiting && (DateTime.UtcNow-lastSummary).TotalSeconds>2) ReadSummary();
            });
        }

        void EnsureService() {
            lock (serviceLock) {
                if (Ready() || exiting) return;
                ownedService = Process.Start(new ProcessStartInfo(node, "\"" + Path.Combine(Root, "server.mjs") + "\"") {
                    WorkingDirectory = Root, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
                });
                for (int i = 0; i < 30 && !exiting && !Ready(); i++) Thread.Sleep(250);
                if (!exiting && !Ready()) throw new Exception("本地服务未能启动，请查看 artifacts/launcher.log。");
            }
        }

        void ReadSummary() {
            if (readingSummary || savingTheme || exiting) return;
            readingSummary = true;
            lastSummary = DateTime.UtcNow;
            int revision = themeRevision;
            ThreadPool.QueueUserWorkItem(delegate {
                List<QuotaSummary.Card> rows; bool failed = false; string nextTheme = themeMode,updatedText=null; QuotaSummary.RefreshInfo refreshInfo=null;
                try {
                    EnsureService();
                    var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:4317/api/dashboard");
                    request.Timeout = 2500; request.ReadWriteTimeout = 2500; request.Proxy = null; request.AllowAutoRedirect = false;
                    using (var response = request.GetResponse())
                    using (var reader = new StreamReader(response.GetResponseStream())) {
                        string json = reader.ReadToEnd(); rows = QuotaSummary.Cards(json); nextTheme = QuotaSummary.Theme(json); refreshInfo=QuotaSummary.Refresh(json);
                        updatedText=QuotaSummary.LastUpdated(json);
                    }
                    summary = rows;
                } catch {
                    rows = summary; failed = true;
                }
                if (exiting) return;
                try { dispatcher.BeginInvoke((Action)delegate {
                    readingSummary = false;
                    if(updatedText!=null)popup.SetLastUpdated(updatedText);
                    if (!savingTheme && revision == themeRevision) {
                        themeMode = nextTheme; popup.ApplyTheme(themeMode);
                        string signature = failed + new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(rows);
                        if (signature != summarySignature) { summarySignature = signature; popup.SetCards(rows, failed); }
                        if(refreshInfo!=null&&!startingRefresh)popup.SetRefreshState(refreshInfo.Running,refreshInfo.Message);
                    }
                }); }
                catch (InvalidOperationException) {}
            });
        }

        void StartRefresh() {
            if(startingRefresh)return;
            startingRefresh=true;popup.SetRefreshState(true,"正在启动后台刷新…");
            ThreadPool.QueueUserWorkItem(delegate {
                string failure=null;
                try {
                    EnsureService();
                    var request=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:4317/api/desktop/refresh");
                    request.Method="POST";request.ContentType="application/json";request.Headers["X-Headroom-Client"]="local";
                    request.Timeout=30000;request.ReadWriteTimeout=30000;request.Proxy=null;request.AllowAutoRedirect=false;
                    byte[] bytes=Encoding.UTF8.GetBytes("{}");request.ContentLength=bytes.Length;
                    using(var stream=request.GetRequestStream())stream.Write(bytes,0,bytes.Length);
                    using(var response=request.GetResponse()){}
                } catch(WebException error) {
                    failure="无法启动刷新，请检查 Edge 和扩展。";
                    if(error.Response!=null)try {using(var reader=new StreamReader(error.Response.GetResponseStream())){
                        var data=new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
                        if(data.ContainsKey("error"))failure=Convert.ToString(data["error"]);
                    }}catch{}
                } catch {failure="本机服务连接失败，请重试。";}
                if(exiting)return;
                try{dispatcher.BeginInvoke((Action)delegate {
                    startingRefresh=false;
                    if(failure!=null){popup.SetRefreshState(false,failure);ShowError(new Exception(failure));}
                    else {popup.SetRefreshState(true,"后台正在并行刷新…");ReadSummary();}
                });}catch(InvalidOperationException){}
            });
        }

        void SaveTheme(string mode) {
            if (savingTheme) { popup.ApplyTheme(themeMode); return; }
            savingTheme = true;
            themeRevision++;
            ThreadPool.QueueUserWorkItem(delegate {
                Exception failure = null;
                try {
                    EnsureService();
                    var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:4317/api/preferences");
                    request.Method = "POST"; request.ContentType = "application/json"; request.Headers["X-Headroom-Client"] = "local";
                    request.Timeout = 5000; request.ReadWriteTimeout = 5000; request.Proxy = null; request.AllowAutoRedirect = false;
                    byte[] payload = Encoding.UTF8.GetBytes("{\"theme\":\"" + mode + "\"}"); request.ContentLength = payload.Length;
                    using (var stream = request.GetRequestStream()) stream.Write(payload, 0, payload.Length);
                    using (var response = request.GetResponse()) {}
                } catch (Exception error) { failure = error; }
                if (exiting) return;
                try { dispatcher.BeginInvoke((Action)delegate {
                    savingTheme = false;
                    if (failure == null) themeMode = mode;
                    else ShowError(new Exception("外观未能保存，请重试。"));
                    popup.ApplyTheme(themeMode); ReadSummary();
                }); } catch (InvalidOperationException) {}
            });
        }

        void ShowError(Exception error) {
            Log("ERROR " + error.Message);
            tray.ShowBalloonTip(6000, "AI head-up dispaly 暂时无法打开", error.Message, ToolTipIcon.Error);
        }

        void OpenToolbar() {
            if (opening || exiting) return;
            IntPtr existing = FindToolbar();
            if (existing != IntPtr.Zero) {
                CompactToolbar(existing);
                SetForegroundWindow(existing);
                Log("FOCUS existing toolbar");
                return;
            }
            if ((DateTime.UtcNow - lastLaunch).TotalSeconds < 3) return;
            opening = true;
            tray.Text = "AI head-up dispaly · 正在打开";
            ThreadPool.QueueUserWorkItem(delegate {
                Exception failure = null;
                try {
                    EnsureService();
                    if (!exiting) {
                        Process.Start(new ProcessStartInfo(edge, "--app=http://127.0.0.1:4317/toolbar --window-size=440,740") { UseShellExecute = false });
                        lastLaunch = DateTime.UtcNow;
                        Log("OPEN toolbar; existing Edge profile and extension are reused");
                        // Edge can restore a maximized app window despite --window-size.
                        for (int i = 0; i < 60 && !exiting; i++) {
                            IntPtr window = FindToolbar();
                            if (window != IntPtr.Zero) { CompactToolbar(window); break; }
                            Thread.Sleep(150);
                        }
                    }
                } catch (Exception error) { failure = error; }
                if (!exiting) {
                    try { dispatcher.BeginInvoke((Action)delegate {
                        opening = false;
                        tray.Text = "AI head-up dispaly · 点击打开 AI 额度";
                        if (failure != null) ShowError(failure);
                    }); } catch (InvalidOperationException) {}
                }
                if (exiting) StopOwnedService();
            });
        }

        void StopOwnedService() {
            try { if (ownedService != null && !ownedService.HasExited) ownedService.Kill(); } catch {}
        }
        protected override void ExitThreadCore() {
            exiting = true;
            signals.Stop(); signals.Dispose();
            tray.Visible = false; tray.Dispose();
            popup.Dispose();
            IntPtr window = FindToolbar();
            if (window != IntPtr.Zero) PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
            StopOwnedService();
            dispatcher.Dispose();
            Log("TRAY exited");
            base.ExitThreadCore();
        }
    }

    static void CompactToolbar(IntPtr window) {
        ShowWindow(window, 9); // Restore before sizing, including maximized windows.
        var work = Screen.FromHandle(window).WorkingArea;
        int width = Math.Min(440, work.Width - 24), height = Math.Min(800, work.Height - 24);
        SetWindowPos(window, IntPtr.Zero, work.Right - width - 12, work.Top + Math.Max(12, (work.Height - height) / 2), width, height, 0x0014);
    }

    // Only match Headroom's Edge app window, never a normal browser tab/window.
    static IntPtr FindToolbar() {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr param) {
            var title = new StringBuilder(512);
            GetWindowText(window, title, title.Capacity);
            if (title.ToString() != "AI head-up dispaly · 额度工具栏" && title.ToString() != "Headroom · 额度工具栏") return true;
            uint pid;
            GetWindowThreadProcessId(window, out pid);
            try { using (var process = Process.GetProcessById((int)pid)) {
                if (process.ProcessName.Equals("msedge", StringComparison.OrdinalIgnoreCase)) { found = window; return false; }
            } } catch {}
            return true;
        }, IntPtr.Zero);
        return found;
    }
    delegate bool WindowCallback(IntPtr window, IntPtr param);
    static bool HideCollector(string id) {
        if (!System.Text.RegularExpressions.Regex.IsMatch(id, "\\A[a-f0-9]{32}\\z")) return false;
        string marker = "AIHUD-Collector-" + id;
        for (int attempt = 0; attempt < 80; attempt++) {
            bool hidden = false;
            EnumWindows(delegate(IntPtr window, IntPtr param) {
                var title = new StringBuilder(512); GetWindowText(window, title, title.Capacity);
                if (title.ToString() != marker && !title.ToString().StartsWith(marker + " - ", StringComparison.Ordinal)) return true;
                uint pid; GetWindowThreadProcessId(window, out pid);
                try { using (var process = Process.GetProcessById((int)pid)) {
                    if (process.ProcessName.Equals("msedge", StringComparison.OrdinalIgnoreCase)) {
                        ShowWindow(window, 0); hidden = !IsWindowVisible(window); return !hidden;
                    }
                } } catch {}
                return true;
            }, IntPtr.Zero);
            if (hidden) return true;
            Thread.Sleep(100);
        }
        return false;
    }
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback, IntPtr param);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [STAThread]
    static int Main(string[] args) {
        try {
            if (args.Length == 2 && args[0] == "--hide-collector") return HideCollector(args[1]) ? 0 : 1;
            if (args.Length == 1 && args[0] == "--wake-browser") {
                Process.Start(new ProcessStartInfo(Find("msedge.exe", "Microsoft\\Edge\\Application"), "--no-startup-window") {
                    UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
                });
                return 0;
            }
            if (args.Length > 0 && args[0] == "--enable-startup") { SetStartup(true); return 0; }
            if (args.Length > 0 && args[0] == "--disable-startup") { SetStartup(false); return 0; }
            if (args.Length > 0 && args[0] == "--exit") {
                using (var signal = EventWaitHandle.OpenExisting(InstanceName + "-exit")) signal.Set();
                return 0;
            }
            string node = Find("node.exe", "nodejs");
            string edge = Find("msedge.exe", "Microsoft\\Edge\\Application");
            if (args.Length > 0 && args[0] == "--check") {
                Log("CHECK node=found edge=found service=" + Ready()); return 0;
            }
            bool first;
            using (var show = new EventWaitHandle(false, EventResetMode.AutoReset, InstanceName + "-show"))
            using (var stop = new EventWaitHandle(false, EventResetMode.AutoReset, InstanceName + "-exit"))
            using (var peek = new EventWaitHandle(false, EventResetMode.AutoReset, InstanceName + "-peek"))
            using (var settings = new EventWaitHandle(false, EventResetMode.AutoReset, InstanceName + "-settings"))
            using (var mutex = new Mutex(true, InstanceName, out first)) {
                if (!first) {
                    if (args.Length > 0 && args[0] == "--settings") settings.Set();
                    else if (args.Length > 0 && args[0] == "--peek") peek.Set();
                    else if (args.Length == 0 || args[0] != "--background") show.Set();
                    Log("ACTIVATE existing tray");
                    return 0;
                }
                try {
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    using (var context = new TrayContext(node, edge, show, stop, peek, settings,
                        args.Length > 0 && (args[0] == "--background" || args[0] == "--peek" || args[0] == "--settings"), args.Length > 0 && args[0] == "--peek", args.Length > 0 && args[0] == "--settings"))
                        Application.Run(context);
                } finally { mutex.ReleaseMutex(); }
            }
            return 0;
        } catch(Exception error) {
            Log("ERROR "+error.Message);
            MessageBox.Show(error.Message,"AI head-up dispaly could not open",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;
        }
    }
}
