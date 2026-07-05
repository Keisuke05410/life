// 当日の天気を取得し、Discord チャンネルへ Embed で通知する。
// GitHub Actions の cron から毎朝実行される想定。LLM は使わず、
// weather.ts の決定的ロジックだけで完結する。
//
// 必要な環境変数:
//   DISCORD_WEBHOOK_URL … 投稿先チャンネルの Webhook URL

import { getTodayWeather, type WeatherResult } from "./weather.js";

/** 天気コード（日本語ラベル）からタイトル用の絵文字を選ぶ */
function weatherEmoji(weather: string): string {
  if (weather.includes("雷")) return "⛈️";
  if (weather.includes("雪")) return "❄️";
  if (weather.includes("雨") || weather.includes("霧雨")) return "🌧️";
  if (weather.includes("霧")) return "🌫️";
  if (weather.includes("曇")) return "☁️";
  if (weather.includes("快晴")) return "☀️";
  if (weather.includes("晴")) return "🌤️";
  return "🌡️";
}

/**
 * Embed の左バー色を決める。
 * 雨（傘が要る）→ 青、洗濯がよく乾く→ 緑、乾きにくい→ 黄、それ以外→ グレー。
 */
function embedColor(r: WeatherResult): number {
  if (r.umbrella.needed === "必要") return 0x3498db; // 青
  if (r.laundry.index >= 60) return 0x2ecc71; // 緑（よく乾く/乾く）
  if (r.laundry.index < 45) return 0xf1c40f; // 黄（乾きにくい）
  return 0x95a5a6; // グレー
}

const fmtTemp = (v: number | null) => (v == null ? "—" : `${Math.round(v)}℃`);
const fmtPct = (v: number | null) => (v == null ? "—" : `${v}%`);
const fmtMm = (v: number | null) => (v == null ? "—" : `${v}mm`);

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

/** WeatherResult を Discord Embed オブジェクトへ変換する */
function buildEmbed(r: WeatherResult): Record<string, unknown> {
  const fields: DiscordEmbedField[] = [
    {
      name: "🌡️ 気温",
      value: `最高 ${fmtTemp(r.temperatureMax)} / 最低 ${fmtTemp(
        r.temperatureMin,
      )}\n現在 ${fmtTemp(r.temperatureNow)}`,
      inline: true,
    },
    {
      name: "💧 湿度",
      value: `${fmtPct(r.humidity)}（現在）`,
      inline: true,
    },
    {
      name: "🌧️ 降水",
      value: `確率 ${fmtPct(r.precipitationProbabilityMax)}\n予想 ${fmtMm(
        r.precipitationSum,
      )}`,
      inline: true,
    },
    {
      name: "☂️ 傘",
      value: `**${r.umbrella.needed}**\n${r.umbrella.reason}`,
      inline: false,
    },
  ];

  // 洗濯物: スコア・レベル・アドバイス＋（あれば）おすすめ/避ける時間帯
  const laundryLines = [
    `**${r.laundry.level}**（乾きやすさ ${r.laundry.index}/100）`,
    r.laundry.advice,
    r.laundry.reason,
  ];
  if (r.laundry.bestWindow) laundryLines.push(`🕐 ${r.laundry.bestWindow}`);
  if (r.laundry.avoidHours) laundryLines.push(`🚫 ${r.laundry.avoidHours}`);
  fields.push({
    name: "🧺 洗濯物",
    value: laundryLines.join("\n"),
    inline: false,
  });

  const today = new Date().toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  return {
    title: `${weatherEmoji(r.weather)} ${r.location}の今日の天気: ${r.weather}`,
    color: embedColor(r),
    fields,
    footer: { text: `${today} ・ データ: Open-Meteo` },
  };
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
  const embed = buildEmbed(result);

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      `Discord への送信に失敗しました: ${res.status} ${res.statusText}\n${body}`,
    );
    process.exit(1);
  }

  console.log(`Discord へ通知しました: ${result.location} / ${result.weather}`);
}

main().catch((err) => {
  console.error("通知処理でエラーが発生しました:", err);
  process.exit(1);
});
