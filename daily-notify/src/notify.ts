// 当日の天気を取得し、Discord チャンネルへ 1 枚のダッシュボード画像で通知する。
// 画像に加えて、通知プレビュー/検索性のため 1 行のテキスト要約も添える。
// GitHub Actions の cron から毎朝実行される想定。LLM は使わず、
// weather.ts の決定的ロジックだけで完結する。
//
// 必要な環境変数:
//   DISCORD_WEBHOOK_URL … 投稿先チャンネルの Webhook URL

import { buildDashboardHtml } from "./dashboard.js";
import { type GarbageInfo, getGarbage } from "./garbage.js";
import {
  fetchWithRetry,
  fetchWithTimeout,
  fmtTemp,
  weatherKind,
} from "./lib.js";
import { renderPng } from "./render.js";
import { getTodayWeather, type WeatherResult } from "./weather.js";

/** テキスト要約の先頭に付ける天気絵文字（Discord が描画するので絵文字でよい） */
function summaryEmoji(weather: string): string {
  switch (weatherKind(weather)) {
    case "thunder":
      return "⛈️";
    case "snow":
      return "❄️";
    case "rain":
      return "🌧️";
    case "fog":
      return "🌫️";
    case "cloud":
      return "☁️";
    case "clear":
      return weather.includes("快晴") ? "☀️" : "🌤️";
    default:
      return "🌡️";
  }
}

/** 通知プレビュー用の 1 行要約 */
function buildSummary(r: WeatherResult, g: GarbageInfo): string {
  const mainWord = r.weather.split(/\s/)[0] || r.weather;
  const temps = `${fmtTemp(r.temperatureMax)}/${fmtTemp(r.temperatureMin)}`;
  const garbage = g.today.categories.map((c) => c.label).join("・") || "なし";
  return `${summaryEmoji(mainWord)} ${r.location} ${r.weather} ${temps}・洗濯: ${r.laundry.level}(${r.laundry.index})・ゴミ: ${garbage}`;
}

/** 画像 1 枚 + テキストを multipart/form-data で Webhook へ送信 */
async function postImage(
  webhookUrl: string,
  png: Buffer,
  content: string,
): Promise<void> {
  const buildForm = () => {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content }));
    form.append(
      "files[0]",
      new Blob([new Uint8Array(png)], { type: "image/png" }),
      "weather.png",
    );
    return form;
  };

  // 通知の生命線なので、一時的な失敗（ネットワーク/5xx/429）はリトライする
  const res = await fetchWithRetry(() =>
    fetchWithTimeout(webhookUrl, { method: "POST", body: buildForm() }),
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Discord への送信に失敗しました: ${res.status} ${res.statusText}\n${body}`,
    );
  }
}

async function main(): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error(
      "環境変数 DISCORD_WEBHOOK_URL が設定されていません。Discord の Webhook URL を指定してください。",
    );
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
