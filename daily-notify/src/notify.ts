// 当日の天気を取得し、Discord チャンネルへ 1 枚のダッシュボード画像で通知する。
// 画像に加えて、通知プレビュー/検索性のため 1 行のテキスト要約も添える。
// GitHub Actions の cron から毎朝実行される想定。LLM は使わず、
// weather.ts の決定的ロジックだけで完結する。
//
// 必要な環境変数:
//   DISCORD_WEBHOOK_URL … 投稿先チャンネルの Webhook URL

import { getTodayWeather, type WeatherResult } from "./weather.js";
import { getGarbage, type GarbageInfo } from "./garbage.js";
import { buildDashboardHtml } from "./dashboard.js";
import { renderPng } from "./render.js";

/** テキスト要約の先頭に付ける天気絵文字（Discord が描画するので絵文字でよい） */
function summaryEmoji(weather: string): string {
  if (weather.includes("雷")) return "⛈️";
  if (weather.includes("雪")) return "❄️";
  if (weather.includes("雨") || weather.includes("霧雨")) return "🌧️";
  if (weather.includes("霧")) return "🌫️";
  if (weather.includes("曇")) return "☁️";
  if (weather.includes("快晴")) return "☀️";
  if (weather.includes("晴")) return "🌤️";
  return "🌡️";
}

const fmtTemp = (v: number | null) => (v == null ? "—" : `${Math.round(v)}°`);

/** 通知プレビュー用の 1 行要約 */
function buildSummary(r: WeatherResult, g: GarbageInfo): string {
  const mainWord = r.weather.split(/\s/)[0] || r.weather;
  const temps = `${fmtTemp(r.temperatureMax)}/${fmtTemp(r.temperatureMin)}`;
  const garbage =
    g.today.categories.map((c) => c.label).join("・") || "なし";
  return `${summaryEmoji(mainWord)} ${r.location} ${r.weather} ${temps}・洗濯: ${r.laundry.level}(${r.laundry.index})・ゴミ: ${garbage}`;
}

/** 画像 1 枚 + テキストを multipart/form-data で Webhook へ送信 */
async function postImage(
  webhookUrl: string,
  png: Buffer,
  content: string,
): Promise<void> {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content }));
  form.append(
    "files[0]",
    new Blob([new Uint8Array(png)], { type: "image/png" }),
    "weather.png",
  );

  const res = await fetch(webhookUrl, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      `Discord への送信に失敗しました: ${res.status} ${res.statusText}\n${body}`,
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error(
      "環境変数 DISCORD_WEBHOOK_URL が設定されていません。Discord の Webhook URL を指定してください。",
    );
    process.exit(1);
  }

  const result = await getTodayWeather();
  const garbage = getGarbage();
  const png = await renderPng(buildDashboardHtml(result, garbage));
  await postImage(webhookUrl, png, buildSummary(result, garbage));

  console.log(
    `Discord へ通知しました: ${result.location} / ${result.weather}（洗濯: ${result.laundry.level}）`,
  );
}

main().catch((err) => {
  console.error("通知処理でエラーが発生しました:", err);
  process.exit(1);
});
