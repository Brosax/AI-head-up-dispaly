using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

internal static class QuotaSummaryTests {
    static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    static int Main() {
        var serializer = new JavaScriptSerializer();
        var pools = new List<object>();
        var data = new { providers = new object[0], pools = pools,
            api = new { deepseek = new { freshness = "stale", isAvailable = false, balances = new[] {
                new { currency = "CNY", total = "18.600001" }, new { currency = "USD", total = "0.00" }
            } } } };
        pools.Add(new { provider = "anthropic", accountKey = "a", window = "Weekly", remaining = (decimal?)94, status = "fresh" });
        pools.Add(new { provider = "anthropic", accountKey = "a", window = "Session (5hr)", remaining = (decimal?)null, status = "stale" });
        var rows = QuotaSummary.Rows(serializer.Serialize(data));
        Check(rows.Count == 5, "One row per provider; shared windows must stay on the same provider row");
        Check(rows[1].Contains("本周 94%") && rows[1].Contains("5 小时 未知（上次）"), "Null is unknown and each window keeps its freshness");
        Check(rows[0].Contains("尚无读数"), "Missing subscriptions must not become zero");
        Check(rows[4].Contains("CNY 18.600001 / USD 0.00（上次）") && rows[4].Contains("API 不可用"), "Money must keep precision, currency and availability");
        pools.Add(new { provider = "anthropic", accountKey = "b", accountLabel = "Other", window = "Weekly", remaining = 12, status = "expired" });
        rows = QuotaSummary.Rows(serializer.Serialize(data));
        Check(rows.Exists(row => row.Contains("Other · 本周 12%（待更新）")), "Multiple accounts must remain separately identified");
        bool rejected = false;
        try { QuotaSummary.Rows("{}"); } catch (FormatException) { rejected = true; }
        Check(rejected, "Invalid dashboard must not render as an empty account");
        var cards = QuotaSummary.Cards(serializer.Serialize(data));
        Check(cards.Count == 6 && cards.FindAll(card => card.Id == "anthropic").Count == 2, "Popup must keep separate account cards");
        Check(cards.Find(card => card.Id == "deepseek").Metrics[0].Value == "¥ 18.600001" && cards.Find(card => card.Id == "deepseek").Metrics[0].Percent == null, "API cards must preserve money and never draw a percentage bar");
        Check(cards.Find(card => card.Id == "anthropic").Metrics[1].Value == "—", "Popup unknown values must not be zero");
        Check(QuotaSummary.Theme("{}") == "system" && QuotaSummary.Theme("{\"preferences\":{\"theme\":\"dark\"}}") == "dark", "Theme preference falls back safely and reads stored mode");
        Check(!QuotaSummary.Refresh("{\"desktop\":{\"connected\":false}} ").Running, "Disconnected desktop is never shown as collecting");
        Check(QuotaSummary.Refresh("{\"desktop\":{\"refresh\":{\"status\":\"running\",\"startedAt\":\"2026-10-25T00:00:00Z\"}},\"pools\":[],\"api\":{}}").Message.Contains("0 / 4"), "Refresh progress counts provider completion without mixing balances");
        string apiJson="{\"providers\":[],\"pools\":[],\"api\":{\"claude\":{\"enabled\":true,\"accounts\":[{\"freshness\":\"fresh\",\"purchased\":\"0.00\",\"promotional\":[{\"remaining\":\"75.25\",\"granted\":\"100.00\",\"expiresOn\":\"2026-11-01\",\"appliesTo\":\"API\"}]}]}}}";
        var claudeCard=QuotaSummary.Cards(apiJson).Find(card=>card.Id=="claude-api");
        Check(claudeCard.Metrics.Count==1&&claudeCard.Metrics[0].Value=="$ 75.25"&&claudeCard.Metrics[0].Percent==null,"Claude API shows promotional money only, independent from subscription percentages");
        Check(claudeCard.Metrics[0].Detail.Contains("2026-11-01")&&claudeCard.Metrics[0].Detail.Contains("100.00"),"Expiry and original promotional grant are preserved");
        var now=DateTimeOffset.Parse("2026-10-25T14:00:00Z");
        Check(QuotaSummary.ResetText("Session (5hr)","2026-10-25T17:30:00Z",now)=="今天 18:30 重置","Five-hour reset must use Madrid local clock");
        Check(QuotaSummary.ResetText("Session (5hr)","2026-10-26T00:30:00Z",now)=="明天 01:30 重置","Reset day must be explicit across midnight");
        Check(QuotaSummary.ResetText("Weekly","2026-10-28T17:30:00Z",now)=="还有 3 天重置","Weekly reset must show remaining days");
        string openaiJson="{\"providers\":[],\"pools\":[],\"api\":{\"openai\":{\"enabled\":true,\"remaining\":\"82.00\",\"freshness\":\"stale\",\"observedAt\":\"2026-10-29T10:00:00Z\"}},\"desktop\":{\"refresh\":{\"status\":\"running\",\"startedAt\":\"2026-10-29T09:59:00Z\"}}}";
        var openaiCard=QuotaSummary.Cards(openaiJson).Find(card=>card.Id=="openai-api");
        Check(openaiCard.Metrics[0].Value=="$ 82.00"&&openaiCard.Metrics[0].Percent==null&&openaiCard.Metrics[0].Status=="stale","OpenAI API stays money, preserves stale amount and never joins Codex percentages");
        Check(QuotaSummary.Cards(openaiJson.Replace("\"82.00\"","null")).Find(card=>card.Id=="openai-api").Metrics.Count==0,"Unknown OpenAI balance never becomes zero");
        Check(QuotaSummary.Rows(openaiJson).Exists(row=>row.Contains("OpenAI API · USD 82.00（上次）")),"Text summary includes OpenAI balance independently");
        Check(QuotaSummary.Refresh(openaiJson).Message.Contains("1 / 5"),"Progress counts the additional OpenAI API source");
        Console.WriteLine("PASS: 21 tray summary checks");
        return 0;
    }
}
