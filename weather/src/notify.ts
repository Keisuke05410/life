// 当日の天気を取得し、Discord チャンネルへ 2 通の Embed で通知する。
//   1 通目: 洗濯物アドバイス
//   2 通目: 天気・気温（朝・昼・夜 + 降水確率）
// GitHub Actions の cron から毎朝実行される想定。LLM は使わず、
// weather.ts の決定的ロジックだけで完結する。
//
// 必要な環境変数:
//   DISCORD_WEBHOOK_URL … 投稿先チャンネルの Webhook URL

import {
  getTodayWeather,
  type WeatherResult,
  type PeriodWeather,
} from "./weather.js";

/** 天気コード（日本語ラベル）からタイトル用の絵文字を選ぶ */
function weatherEmoji(weather: string | null): string {
  if (!weather) return "🌡️";
  if (weather.includes("雷")) return "⛈️";
  if (weather.includes("雪")) return "❄️";
  if (weather.includes("雨") || weather.includes("霧雨")) return "🌧️";
  if (weather.includes("霧")) return "🌫️";
  if (weather.includes("曇")) return "☁️";
  if (weather.includes("快晴")) return "☀️";
  if (weather.includes("晴")) return "🌤️";
  return "🌡️";
}

const fmtTemp = (v: number | null) => (v == null ? "—" : `${Math.round(v)}℃`);
const fmtPct = (v: number | null) => (v == null ? "—" : `${v}%`);

const fmtRange = (p: PeriodWeather) =>
  p.tempMin == null || p.tempMax == null
    ? "—"
    : `${Math.round(p.tempMin)}〜${Math.round(p.tempMax)}℃`;

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

// ---- 1 通目: 洗濯物 Embed ----

/** 洗濯スコアで左バー色を決める（よく乾く→緑 / 乾きにくい→黄 / 中間→グレー） */
function laundryColor(index: number): number {
  if (index >= 60) return 0x2ecc71; // 緑
  if (index < 45) return 0xf1c40f; // 黄
  return 0x95a5a6; // グレー
}

function buildLaundryEmbed(r: WeatherResult): Record<string, unknown> {
  const l = r.laundry;
  const fields: DiscordEmbedField[] = [
    {
      name: "判定",
      value: `**${l.level}**（乾きやすさ ${l.index}/100）\n${l.advice}`,
      inline: false,
    },
    { name: "根拠", value: l.reason, inline: false },
  ];
  if (l.bestWindow) {
    fields.push({
      name: "🕐 最も乾きやすい時間帯",
      value: l.bestWindow,
      inline: true,
    });
  }
  if (l.avoidHours) {
    fields.push({
      name: "🚫 外干しを避けたい時間帯",
      value: l.avoidHours,
      inline: true,
    });
  }
  return {
    title: `🧺 ${r.location}の洗濯物`,
    color: laundryColor(l.index),
    fields,
  };
}

// ---- 2 通目: 天気・気温 Embed ----

/** 当日の代表天気で左バー色を決める（雨→青 / 晴→黄 / それ以外→グレー） */
function weatherColor(weather: string): number {
  if (weather.includes("雨") || weather.includes("雷") || weather.includes("雪"))
    return 0x3498db; // 青
  if (weather.includes("晴")) return 0xf1c40f; // 黄
  return 0x95a5a6; // グレー
}

/** 時間帯サマリを Embed フィールドへ */
function periodField(emoji: string, p: PeriodWeather): DiscordEmbedField {
  return {
    name: `${emoji} ${p.label}`,
    value: `${p.weather ?? "—"}\n${fmtRange(p)}\n降水 ${fmtPct(p.precipProbMax)}`,
    inline: true,
  };
}

function buildWeatherEmbed(r: WeatherResult): Record<string, unknown> {
  const today = new Date().toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  const fields: DiscordEmbedField[] = [
    periodField("🌅", r.periods.morning),
    periodField("☀️", r.periods.afternoon),
    periodField("🌙", r.periods.evening),
    {
      name: "🌡️ 本日の気温",
      value: `最高 ${fmtTemp(r.temperatureMax)} / 最低 ${fmtTemp(
        r.temperatureMin,
      )}`,
      inline: false,
    },
  ];

  return {
    title: `${weatherEmoji(r.weather)} ${r.location}の今日の天気: ${r.weather}`,
    color: weatherColor(r.weather),
    fields,
    footer: { text: `${today} ・ データ: Open-Meteo` },
  };
}

// ---- 送信 ----

async function postEmbed(
  webhookUrl: string,
  embed: Record<string, unknown>,
  label: string,
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      `Discord への送信に失敗しました (${label}): ${res.status} ${res.statusText}\n${body}`,
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

  // 順序保証のため、洗濯物 → 天気 の順に逐次送信する。
  await postEmbed(webhookUrl, buildLaundryEmbed(result), "洗濯物");
  await postEmbed(webhookUrl, buildWeatherEmbed(result), "天気");

  console.log(
    `Discord へ通知しました: ${result.location} / ${result.weather}（洗濯: ${result.laundry.level}）`,
  );
}

main().catch((err) => {
  console.error("通知処理でエラーが発生しました:", err);
  process.exit(1);
});
