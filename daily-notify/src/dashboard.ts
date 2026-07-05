// WeatherResult から、Discord へ送る 1 枚のダッシュボード画像用 HTML を生成する。
// デザインは shadcn/ui 風のダーク（黒背景）カード。天気予報がメインで、
// 洗濯物は下部の細いストリップにサブ表示する。アイコンは絵文字ではなく
// インライン SVG（lucide 系のライン）で描き、絵文字フォント依存を避ける。
//
// この HTML を render.ts の Playwright で #card 要素だけ PNG 化する。

import type { WeatherResult, PeriodWeather } from "./weather.js";
import type { GarbageInfo, DayGarbage } from "./garbage.js";

// ---- SVG アイコン（lucide のパス） ----

const ICON_PATHS: Record<string, string> = {
  "map-pin":
    '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  "cloud-rain":
    '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>',
  "cloud-storm":
    '<path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"/><path d="m13 12-3 5h4l-3 5"/>',
  "cloud-fog":
    '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="M16 17H7"/><path d="M17 21H9"/>',
  "cloud-sun":
    '<path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M15.947 12.65a4 4 0 0 0-5.925-4.128"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
  snowflake:
    '<path d="m10 20-1.25-2.5L6 18"/><path d="M10 4 8.75 6.5 6 6"/><path d="m14 20 1.25-2.5L18 18"/><path d="m14 4 1.25 2.5L18 6"/><path d="m17 21-3-6h-4"/><path d="m17 3-3 6 1.5 3"/><path d="M2 12h6.5L10 9"/><path d="m20 10-1.5 2 1.5 2"/><path d="M22 12h-6.5L14 15"/><path d="m4 10 1.5 2L4 14"/><path d="m7 21 3-6-1.5-3"/><path d="m7 3 3 6h4"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  "cloud-moon":
    '<path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/><path d="M10.1 9A6 6 0 0 1 16 4a4.24 4.24 0 0 0 6 6 6 6 0 0 1-3 5.197"/>',
  droplet:
    '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7Z"/>',
  shirt:
    '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  umbrella:
    '<path d="M12 22v-9"/><path d="M12 13a5.98 5.98 0 0 0-4.24 1.76M12 13a5.98 5.98 0 0 1 4.24 1.76"/><path d="M20 13a10.06 10.06 0 0 0-16 0"/><path d="M12 13V2"/><path d="M12 22a2 2 0 0 0 2-2"/>',
  clock:
    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  "trash-2":
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  flame:
    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  recycle:
    '<path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5"/><path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12"/><path d="m14 16-3 3 3 3"/><path d="M8.293 13.596 7.196 9.5 3.1 10.598"/><path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843"/><path d="m13.378 9.633 4.096 1.098 1.097-4.096"/>',
  "cup-soda":
    '<path d="m6 8 1.75 12.28a2 2 0 0 0 2 1.72h4.54a2 2 0 0 0 2-1.72L18 8"/><path d="M5 8h14"/><path d="M7 15a6.47 6.47 0 0 1 5 0 6.47 6.47 0 0 0 5 0"/><path d="m12 8 1-6h2"/>',
  newspaper:
    '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
  wine:
    '<path d="M8 22h8"/><path d="M7 10h10"/><path d="M12 15v7"/><path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z"/>',
};

/** 24x24 viewBox のラインアイコンを描く */
function icon(name: string, size: number, color: string): string {
  const paths = ICON_PATHS[name] ?? ICON_PATHS.cloud;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

// ---- 天気ラベル → アイコン種別・色 ----

const COL = {
  rain: "#60a5fa",
  snow: "#93c5fd",
  sun: "#fbbf24",
  neutral: "#94a3b8",
} as const;

/** 天気ラベルからアイコン名と色を選ぶ。period で快晴/晴の昼夜を出し分ける。 */
function weatherIcon(
  weather: string | null,
  period?: "morning" | "afternoon" | "evening",
): { name: string; color: string } {
  if (!weather) return { name: "cloud", color: COL.neutral };
  if (weather.includes("雷")) return { name: "cloud-storm", color: COL.neutral };
  if (weather.includes("雪")) return { name: "snowflake", color: COL.snow };
  if (weather.includes("雨")) return { name: "cloud-rain", color: COL.rain };
  if (weather.includes("霧")) return { name: "cloud-fog", color: COL.neutral };
  if (weather.includes("曇"))
    // 夜間の曇りは月＋雲で「夜」の雰囲気を残す
    return period === "evening"
      ? { name: "cloud-moon", color: COL.neutral }
      : { name: "cloud", color: COL.neutral };
  if (weather.includes("快晴") || weather.includes("晴")) {
    // 一部曇り・晴時々曇りは cloud-sun。快晴/晴で夜間は月。
    if (weather.includes("一部") || weather.includes("時々"))
      return period === "evening"
        ? { name: "moon", color: COL.neutral }
        : { name: "cloud-sun", color: COL.sun };
    return period === "evening"
      ? { name: "moon", color: COL.neutral }
      : { name: "sun", color: COL.sun };
  }
  return { name: "cloud", color: COL.neutral };
}

// ---- 洗濯スコア → 色 ----

/** 洗濯 index からレベル色（ダーク背景で読める明るめ）とドット色を返す */
function laundryColors(index: number): { text: string; dot: string } {
  if (index >= 75) return { text: "#34d399", dot: "#10b981" };
  if (index >= 60) return { text: "#4ade80", dot: "#22c55e" };
  if (index >= 45) return { text: "#fbbf24", dot: "#f59e0b" };
  if (index >= 25) return { text: "#fb923c", dot: "#f97316" };
  return { text: "#f87171", dot: "#ef4444" };
}

// ---- ゴミ出しカテゴリ → アイコン・色 ----

// 色は既存の役割色を再利用（新色は増やさない）:
// 燃やす=警戒系(橙) / 資源(プラ・ペット・古紙・びん缶)=良好系(緑) / 燃やさない=ニュートラル
const GARBAGE_ICON: Record<string, { name: string; color: string }> = {
  burnable: { name: "flame", color: "#fb923c" },
  unburnable: { name: "trash-2", color: COL.neutral },
  plastic: { name: "recycle", color: "#4ade80" },
  pet: { name: "cup-soda", color: "#4ade80" },
  paper: { name: "newspaper", color: "#4ade80" },
  "bottle-can": { name: "wine", color: "#4ade80" },
};

/** カテゴリのチップ列を組み立てる。size で今日(大)/明日(小)を出し分ける。 */
function garbageChips(day: DayGarbage, size: "lg" | "sm"): string {
  if (day.categories.length === 0) {
    return `<span style="font-size:${size === "lg" ? 14 : 13}px;color:#71717a;">収集なし</span>`;
  }
  const iconSize = size === "lg" ? 16 : 14;
  const fontSize = size === "lg" ? 14 : 12.5;
  const pad = size === "lg" ? "7px 12px" : "5px 9px";
  return day.categories
    .map((c) => {
      const gi = GARBAGE_ICON[c.key] ?? { name: "trash-2", color: COL.neutral };
      // 明日は少し彩度を落として控えめに（透明度で一段沈める）
      const opacity = size === "lg" ? "1" : "0.72";
      return `<span style="display:inline-flex;align-items:center;gap:6px;background:#18181b;border:1px solid #27272a;border-radius:10px;padding:${pad};font-size:${fontSize}px;opacity:${opacity};">${icon(
        gi.name,
        iconSize,
        gi.color,
      )}<span>${esc(c.label)}</span></span>`;
    })
    .join("");
}

/** カード最上部のゴミ出しバナー（今日=メイン / 明日=サブ） */
function garbageBanner(g: GarbageInfo): string {
  const dayLabel = (d: DayGarbage) => `(${d.weekdayLabel})`;
  return `
    <div style="padding:16px 22px 15px;border-bottom:1px solid #18181b;">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:12px;">
        ${icon("trash-2", 16, "#71717a")}
        <span style="font-size:12px;color:#71717a;letter-spacing:0.06em;">ゴミ出し</span>
      </div>
      <div style="display:flex;align-items:flex-start;gap:14px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;color:#a1a1aa;margin-bottom:8px;">今日 <span style="color:#71717a;">${dayLabel(
            g.today,
          )}</span></div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">${garbageChips(g.today, "lg")}</div>
        </div>
        <div style="width:1px;align-self:stretch;background:#27272a;"></div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;color:#71717a;margin-bottom:8px;">明日 <span style="color:#52525b;">${dayLabel(
            g.tomorrow,
          )}</span></div>
          <div style="display:flex;flex-wrap:wrap;gap:7px;">${garbageChips(g.tomorrow, "sm")}</div>
        </div>
      </div>
    </div>`;
}

// ---- フォーマッタ ----

const fmtTemp = (v: number | null) => (v == null ? "—" : `${Math.round(v)}°`);
const fmtRange = (p: PeriodWeather) =>
  p.tempMin == null || p.tempMax == null
    ? "—"
    : `${Math.round(p.tempMin)}–${Math.round(p.tempMax)}°`;
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );

/** Asia/Tokyo の「2026.07.05 (日)」表記 */
function formatDate(): string {
  const d = new Date();
  const ymd = d.toLocaleDateString("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }); // 2026-07-05
  const wd = d.toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  });
  return `${ymd.replace(/-/g, ".")} (${wd})`;
}

// ---- 時間帯カード ----

const PERIODS: Array<{ key: "morning" | "afternoon" | "evening"; label: string; hours: string }> = [
  { key: "morning", label: "朝", hours: "6–11" },
  { key: "afternoon", label: "昼", hours: "12–17" },
  { key: "evening", label: "夜", hours: "18–23" },
];

function periodCard(key: "morning" | "afternoon" | "evening", label: string, hours: string, p: PeriodWeather): string {
  const wi = weatherIcon(p.weather, key);
  const prob = p.precipProb;
  const badge =
    prob == null
      ? { bg: "#27272a", fg: "#a1a1aa", text: "—" }
      : prob >= 30
        ? { bg: "rgba(59,130,246,0.15)", fg: "#93c5fd", text: `${prob}%` }
        : { bg: "#27272a", fg: "#a1a1aa", text: `${prob}%` };
  return `
      <div style="background:#18181b;border:1px solid #27272a;border-radius:14px;padding:18px 14px 16px;text-align:center;">
        <div style="font-size:13px;color:#a1a1aa;font-weight:500;">${label} <span style="color:#71717a;font-weight:400;">${hours}</span></div>
        <div style="margin:12px 0 10px;display:flex;justify-content:center;">${icon(wi.name, 40, wi.color)}</div>
        <div style="font-size:15px;font-weight:500;">${esc(p.weather ?? "—")}</div>
        <div style="font-size:14px;color:#a1a1aa;margin-top:3px;">${fmtRange(p)}</div>
        <div style="display:inline-flex;align-items:center;gap:4px;margin-top:12px;background:${badge.bg};color:${badge.fg};font-size:13px;padding:3px 10px;border-radius:8px;">
          ${icon("droplet", 13, badge.fg)} ${badge.text}
        </div>
      </div>`;
}

// ---- ダッシュボード HTML ----

export function buildDashboardHtml(r: WeatherResult, g: GarbageInfo): string {
  const mainWord = r.weather.split(/\s/)[0] || r.weather;
  const hi = weatherIcon(mainWord);
  const l = r.laundry;
  const lc = laundryColors(l.index);

  // 洗濯サブストリップの補足（干す/避ける時間帯があれば右側に出す）
  let laundryHint = esc(l.advice);
  if (l.bestWindow) laundryHint = `よく乾く ${esc(l.bestWindow)}`;
  else if (l.avoidHours) laundryHint = `外干しを避けたい ${esc(l.avoidHours)}`;

  const periodsHtml = PERIODS.map((d) =>
    periodCard(d.key, d.label, d.hours, r.periods[d.key]),
  ).join("");

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{background:transparent;font-family:'Noto Sans CJK JP','Hiragino Sans','Noto Sans JP',sans-serif;-webkit-font-smoothing:antialiased;}
    #card{width:600px;background:#09090b;border:1px solid #27272a;border-radius:16px;overflow:hidden;color:#fafafa;}
    svg{display:block;}
  </style></head><body>
  <div id="card">
    ${garbageBanner(g)}
    <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:20px 22px 18px;">
      <div>
        <div style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:500;">
          ${icon("map-pin", 17, "#71717a")} ${esc(r.location)}
        </div>
        <div style="font-size:12px;color:#71717a;margin-top:3px;letter-spacing:0.02em;">${formatDate()}・07:00 更新</div>
      </div>
      <div style="text-align:right;">
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;">
          ${icon(hi.name, 28, hi.color)}
          <span style="font-size:17px;font-weight:500;">${esc(r.weather)}</span>
        </div>
        <div style="font-size:13px;color:#a1a1aa;margin-top:4px;">
          最高 <span style="color:#fafafa;font-weight:500;">${fmtTemp(r.temperatureMax)}</span> <span style="color:#3f3f46;">/</span> 最低 ${fmtTemp(r.temperatureMin)}
        </div>
      </div>
    </div>

    <div style="padding:4px 22px 20px;">
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;">${periodsHtml}
      </div>
    </div>

    <div style="margin:0 22px 18px;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:11px 14px;display:flex;align-items:center;gap:10px;">
      ${icon("shirt", 18, "#71717a")}
      <span style="font-size:12px;color:#71717a;letter-spacing:0.04em;">洗濯物</span>
      <span style="width:6px;height:6px;border-radius:999px;background:${lc.dot};display:inline-block;"></span>
      <span style="font-size:14px;font-weight:500;color:${lc.text};">${esc(l.level)}</span>
      <span style="font-size:12px;color:#71717a;">${l.index}/100</span>
      <span style="font-size:13px;color:#a1a1aa;margin-left:auto;text-align:right;">${laundryHint}</span>
    </div>

    <div style="padding:11px 22px 15px;border-top:1px solid #18181b;font-size:11px;color:#52525b;display:flex;justify-content:space-between;">
      <span>降水確率: 気象庁</span>
      <span>天気・気温: Open-Meteo</span>
    </div>
  </div>
  </body></html>`;
}
