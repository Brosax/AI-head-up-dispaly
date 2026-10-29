using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Web.Script.Serialization;

internal static class QuotaSummary {
    internal sealed class Metric {
        public string Label, Value, Status, Detail, Reset;
        public decimal? Percent;
    }
    internal sealed class Card {
        public string Id, Name, Account;
        public List<Metric> Metrics = new List<Metric>();
    }
    static IDictionary<string, object> Map(object value) { return value as IDictionary<string, object> ?? new Dictionary<string, object>(); }
    static object Get(IDictionary<string, object> map, string key) { object value; return map.TryGetValue(key, out value) ? value : null; }
    static IEnumerable Items(object value) { return value as IList ?? new object[0]; }
    static string Text(object value) { return Convert.ToString(value, CultureInfo.InvariantCulture); }
    public static string Theme(string json) {
        string theme = Text(Get(Map(Get(Map(new JavaScriptSerializer().DeserializeObject(json)), "preferences")), "theme"));
        return theme == "light" || theme == "dark" ? theme : "system";
    }
    internal sealed class RefreshInfo { public bool Running; public string Message; }
    public static string LastUpdated(string json) {
        var data=Map(new JavaScriptSerializer().DeserializeObject(json));DateTimeOffset at;
        if(!DateTimeOffset.TryParse(Text(Get(data,"lastUpdatedAt")),CultureInfo.InvariantCulture,DateTimeStyles.None,out at))return "最后刷新：尚无读数";
        return "最后刷新："+TimeZoneInfo.ConvertTime(at,TimeZoneInfo.FindSystemTimeZoneById("Romance Standard Time")).ToString("MM-dd HH:mm:ss",CultureInfo.InvariantCulture);
    }
    public static RefreshInfo Refresh(string json) {
        var data=Map(new JavaScriptSerializer().DeserializeObject(json));var desktop=Map(Get(data,"desktop"));var job=Map(Get(desktop,"refresh"));
        string status=Text(Get(job,"status"));
        if(status=="running") {
            string started=Text(Get(job,"startedAt"));var complete=new HashSet<string>();
            foreach(object item in Items(Get(data,"pools"))) {var pool=Map(item);if(String.CompareOrdinal(Text(Get(pool,"observedAt")),started)>=0)complete.Add(Text(Get(pool,"provider")));}
            var api=Map(Get(Map(Get(data,"api")),"deepseek"));bool configured=Get(api,"configured") is bool&&(bool)Get(api,"configured");
            int count=complete.Count+(configured&&String.CompareOrdinal(Text(Get(api,"observedAt")),started)>=0?1:0);
            var claude=Map(Get(Map(Get(data,"api")),"claude"));bool enabled=Get(claude,"enabled") is bool&&(bool)Get(claude,"enabled");
            if(enabled&&String.CompareOrdinal(Text(Get(claude,"observedAt")),started)>=0)count++;
            var openai=Map(Get(Map(Get(data,"api")),"openai"));bool openaiEnabled=Get(openai,"enabled") is bool&&(bool)Get(openai,"enabled");
            if(openaiEnabled&&String.CompareOrdinal(Text(Get(openai,"observedAt")),started)>=0)count++;
            return new RefreshInfo {Running=true,Message="后台并行更新 · "+count+" / "+((configured?5:4)+(enabled?1:0)+(openaiEnabled?1:0))+" 家已完成"};
        }
        if(status=="error")return new RefreshInfo {Message=Text(Get(job,"error"))};
        if(status=="ok")return new RefreshInfo {Message="更新完成 · 各家额度已独立显示"};
        return new RefreshInfo {Message=Get(desktop,"connected") is bool&&(bool)Get(desktop,"connected")?"后台已连接 · 点击刷新获取最新额度":"请重新加载扩展以启用托盘刷新"};
    }
    static string Window(string value) {
        if (value == "Weekly") return "本周";
        if (value == "Session (5hr)") return "5 小时";
        if (value == "Session") return "当前周期";
        return value.Replace("\r", " ").Replace("\n", " ");
    }
    internal static string ResetText(string window, string reset, DateTimeOffset now) {
        DateTimeOffset at;
        if(!DateTimeOffset.TryParse(reset,CultureInfo.InvariantCulture,DateTimeStyles.None,out at))return "重置时间待确认";
        double minutes=Math.Ceiling((at-now).TotalMinutes);
        if(minutes<=0)return "已到期 · 待更新";
        if(window=="Weekly")return minutes>=1440?"还有 "+Math.Floor(minutes/1440)+" 天重置":minutes>=60?"还有 "+Math.Floor(minutes/60)+" 小时重置":"还有 "+minutes+" 分钟重置";
        var zone=TimeZoneInfo.FindSystemTimeZoneById("Romance Standard Time");
        var local=TimeZoneInfo.ConvertTime(at,zone);var today=TimeZoneInfo.ConvertTime(now,zone).Date;
        string prefix=local.Date==today?"今天":local.Date==today.AddDays(1)?"明天":local.ToString("MM/dd");
        return prefix+" "+local.ToString("HH:mm")+" 重置";
    }
    public static List<Card> Cards(string json) {
        var data = Map(new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 }.DeserializeObject(json));
        if (!data.ContainsKey("pools") || !data.ContainsKey("providers")) throw new FormatException("Invalid dashboard");
        var result = new List<Card>();
        string[] ids = { "openai", "anthropic", "xai", "google" };
        string[] names = { "Codex", "Claude", "Grok", "Gemini" };
        for (int i = 0; i < ids.Length; i++) {
            var accounts = new Dictionary<string, Card>();
            foreach (object item in Items(Get(data, "pools"))) {
                var pool = Map(item);
                if (Text(Get(pool, "provider")) != ids[i]) continue;
                string key = Text(Get(pool, "accountKey"));
                Card card;
                if (!accounts.TryGetValue(key, out card)) {
                    card = new Card { Id = ids[i], Name = names[i], Account = Text(Get(pool, "accountLabel")) };
                    accounts.Add(key, card);
                }
                object value = Get(pool, "remaining");
                decimal? percent = value == null ? (decimal?)null : Convert.ToDecimal(value, CultureInfo.InvariantCulture);
                card.Metrics.Add(new Metric { Label = Window(Text(Get(pool, "window"))),
                    Value = percent.HasValue ? percent.Value.ToString("0.#", CultureInfo.InvariantCulture) + "%" : "—",
                    Percent = percent, Status = Text(Get(pool, "status")), Reset=ResetText(Text(Get(pool,"window")),Text(Get(pool,"resetsAt")),DateTimeOffset.UtcNow), Detail="重置时间："+Text(Get(pool,"resetsAt"))+" · "+Text(Get(pool,"accountLabel")) });
            }
            if (accounts.Count == 0) result.Add(new Card { Id = ids[i], Name = names[i] });
            foreach (var card in accounts.Values) { if (accounts.Count == 1) card.Account = null; result.Add(card); }
        }
        var api = Map(Get(Map(Get(data, "api")), "deepseek"));
        var apiCard = new Card { Id = "deepseek", Name = "DeepSeek" };
        bool unavailable = Get(api, "isAvailable") is bool && !(bool)Get(api, "isAvailable");
        foreach (object item in Items(Get(api, "balances"))) {
            var balance = Map(item); string currency = Text(Get(balance, "currency"));
            apiCard.Metrics.Add(new Metric { Label = currency + (unavailable ? " · API 不可用" : " 余额"),
                Value = (currency == "CNY" ? "¥ " : currency == "USD" ? "$ " : "") + Text(Get(balance, "total")),
                Status = Text(Get(api, "freshness")) });
        }
        result.Add(apiCard);
        var claude=Map(Get(Map(Get(data,"api")),"claude"));
        var apiAccounts=new List<object>();foreach(object account in Items(Get(claude,"accounts")))apiAccounts.Add(account);
        if(Get(claude,"enabled") is bool&&(bool)Get(claude,"enabled")&&apiAccounts.Count==0)result.Add(new Card{Id="claude-api",Name="Claude API"});
        foreach(object item in apiAccounts) {
            var account=Map(item);var card=new Card{Id="claude-api",Name="Claude API",Account=apiAccounts.Count>1?Text(Get(account,"accountLabel")):null};
            foreach(object grantItem in Items(Get(account,"promotional"))) {
                var grant=Map(grantItem);string expiry=Text(Get(grant,"expiresOn"));
                card.Metrics.Add(new Metric{Label="赠送余额 · USD",Reset=expiry.Length==10?expiry.Substring(5)+" 到期（UTC）":"到期时间待确认",Value="$ "+Text(Get(grant,"remaining")),Status=Text(Get(account,"freshness")),
                    Detail="USD · 原额度 $"+Text(Get(grant,"granted"))+" · "+expiry+" 到期（UTC） · "+Text(Get(grant,"appliesTo"))});
            }
            if(card.Metrics.Count==0)card.Metrics.Add(new Metric{Label="赠送余额 · USD",Value="暂无赠送额度",Status=Text(Get(account,"freshness"))});
            result.Add(card);
        }
        var openai=Map(Get(Map(Get(data,"api")),"openai"));
        if(Get(openai,"enabled") is bool&&(bool)Get(openai,"enabled")) {
            var card=new Card{Id="openai-api",Name="OpenAI API"};
            if(Get(openai,"remaining")!=null)card.Metrics.Add(new Metric{Label="可用余额 · USD",Value="$ "+Text(Get(openai,"remaining")),Status=Text(Get(openai,"freshness")),Detail="当前 OpenAI 平台页面余额"});
            result.Add(card);
        }
        return result;
    }
    public static List<string> Rows(string json) {
        var data = Map(new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 }.DeserializeObject(json));
        if (!data.ContainsKey("pools") || !data.ContainsKey("providers")) throw new FormatException("Invalid dashboard");
        var rows = new List<string>();
        string[] ids = { "openai", "anthropic", "xai", "google" };
        string[] names = { "Codex", "Claude", "Grok", "Gemini" };
        for (int i = 0; i < ids.Length; i++) {
            var pools = new List<IDictionary<string, object>>();
            var accounts = new HashSet<string>();
            foreach (object item in Items(Get(data, "pools"))) {
                var pool = Map(item);
                if (Text(Get(pool, "provider")) != ids[i]) continue;
                pools.Add(pool); accounts.Add(Text(Get(pool, "accountKey")));
            }
            if (pools.Count == 0) { rows.Add(names[i] + " · 尚无读数"); continue; }
            var parts = new List<string>();
            foreach (var pool in pools) {
                object remaining = Get(pool, "remaining");
                string amount = remaining == null ? "未知" : Convert.ToDecimal(remaining, CultureInfo.InvariantCulture).ToString("0.#", CultureInfo.InvariantCulture) + "%";
                string status = Text(Get(pool, "status"));
                string age = status == "fresh" ? "" : status == "expired" ? "（待更新）" : "（上次）";
                string part = Window(Text(Get(pool, "window"))) + " " + amount + age;
                if (accounts.Count > 1) rows.Add(names[i] + " · " + Text(Get(pool, "accountLabel")) + " · " + part);
                else parts.Add(part);
            }
            if (parts.Count > 0) rows.Add(names[i] + " · " + String.Join(" / ", parts));
        }
        var api = Map(Get(Map(Get(data, "api")), "deepseek"));
        var balances = new List<string>();
        foreach (object item in Items(Get(api, "balances"))) {
            var balance = Map(item);
            balances.Add(Text(Get(balance, "currency")) + " " + Text(Get(balance, "total")));
        }
        rows.Add("DeepSeek · " + (balances.Count == 0 ? "尚无余额" : String.Join(" / ", balances))
            + (balances.Count > 0 && Text(Get(api, "freshness")) != "fresh" ? "（上次）" : "")
            + (Get(api, "isAvailable") is bool && !(bool)Get(api, "isAvailable") ? " · API 不可用" : ""));
        var openai=Map(Get(Map(Get(data,"api")),"openai"));
        if(Get(openai,"enabled") is bool&&(bool)Get(openai,"enabled"))rows.Add("OpenAI API · "+(Get(openai,"remaining")==null?"尚无余额":"USD "+Text(Get(openai,"remaining"))+(Text(Get(openai,"freshness"))=="fresh"?"":"（上次）")));
        return rows;
    }
}
